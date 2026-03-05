// trigger-tasks/content-tasks.js
// ─────────────────────────────────────────────────────────────────────────────
// Trigger.dev v4 durable tasks for the content pipeline.
// These run with automatic retry, timeout, and checkpoint-resume.
//
// Wire these in two ways:
//   1. Direct: await tasks.trigger("content-draft-generate", { brief_id })
//   2. From your existing BullMQ worker: call task.trigger() instead of
//      spawning a child process — Trigger.dev queues/retries durably.
//
// NOTE: Uses ESM imports (required by Trigger.dev v4 bundler).
// The scripts/* modules use CJS module.exports — imported via createRequire.

import { task, logger } from "@trigger.dev/sdk";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// CJS interop: use createRequire to load the CJS scripts from ESM context
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── content-draft-generate ────────────────────────────────────────────────────
// Runs the LLM draft generation with 5-minute timeout and 3 automatic retries.

export const contentDraftGenerate = task({
  id: "content-draft-generate",
  maxDuration: 300,           // 5 minutes
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload) => {
    const { brief_id, variant_number = 1, model } = payload;

    logger.info("content-draft-generate starting", { brief_id, variant_number });

    // Load env before anything else
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });

    const { generateDraft } = require("../scripts/content-draft-generate");
    const { Pool } = require("pg");

    const pool = new Pool({
      host:     process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
      port:     parseInt(process.env.POSTGRES_PORT || "15432", 10),
      user:     process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
      password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
      database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
    });

    // Load brief
    const { rows } = await pool.query(`
      SELECT cb.*, b.slug AS brand_slug, b.name AS brand_name
      FROM   content_briefs cb
      JOIN   brands b ON b.id = cb.brand_id
      WHERE  cb.id = $1
    `, [brief_id]);

    if (!rows.length) throw new Error(`Brief not found: ${brief_id}`);
    const brief = rows[0];

    // Generate draft (LLM call)
    const result = await generateDraft(brief, { model });
    const { parsed, tokensInput, tokensOutput, model: modelUsed, generationMs } = result;

    // Persist draft
    const { rows: [draftRow] } = await pool.query(`
      INSERT INTO content_drafts (
        brief_id, variant_number, model_used, tokens_input, tokens_output,
        generation_ms, body_md, subject_line, preview_text, headline,
        cta_text, cta_url, image_prompt, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'scoring')
      ON CONFLICT (brief_id, variant_number) DO UPDATE SET
        model_used    = EXCLUDED.model_used,
        tokens_input  = EXCLUDED.tokens_input,
        tokens_output = EXCLUDED.tokens_output,
        generation_ms = EXCLUDED.generation_ms,
        body_md       = EXCLUDED.body_md,
        subject_line  = EXCLUDED.subject_line,
        status        = 'scoring',
        updated_at    = NOW()
      RETURNING id
    `, [
      brief_id, variant_number, modelUsed, tokensInput, tokensOutput, generationMs,
      parsed.body_md      || null, parsed.subject_line || null,
      parsed.preview_text || null, parsed.headline     || null,
      parsed.cta_text     || null, parsed.cta_url_placeholder || null,
      parsed.image_prompt || null,
    ]);

    const draft_id = draftRow.id;
    logger.info("draft stored, triggering score", { draft_id });

    // Trigger scoring as a child task (chained, durable)
    await contentDraftScore.trigger({ draft_id, brief_id });

    await pool.end();
    return { draft_id, tokens: tokensInput + tokensOutput, generationMs };
  },
});

// ── content-draft-score ───────────────────────────────────────────────────────
// Scores the draft and advances status. 2-minute timeout, 2 retries.

export const contentDraftScore = task({
  id: "content-draft-score",
  maxDuration: 120,
  retry: {
    maxAttempts: 2,
    factor: 1.5,
    minTimeoutInMs: 1_000,
  },
  run: async (payload) => {
    const { draft_id, brief_id } = payload;

    logger.info("content-draft-score starting", { draft_id });

    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });

    const { scoreDraft } = require("../scripts/content-draft-score");
    const { Pool } = require("pg");

    const pool = new Pool({
      host:     process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
      port:     parseInt(process.env.POSTGRES_PORT || "15432", 10),
      user:     process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
      password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
      database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
    });

    const { rows } = await pool.query(`
      SELECT cd.*, cb.channel, cb.topic, cb.target_audience, cb.tone, cb.goal
      FROM   content_drafts cd
      JOIN   content_briefs cb ON cb.id = cd.brief_id
      WHERE  cd.id = $1
    `, [draft_id]);

    if (!rows.length) throw new Error(`Draft not found: ${draft_id}`);
    const draft = rows[0];

    const { scores, notes } = await scoreDraft(draft, draft);

    const THRESHOLD = parseFloat(process.env.CONTENT_QUALITY_THRESHOLD || "0.65");
    const nextStatus = (scores.score_quality >= THRESHOLD && scores.score_toxicity < 0.3)
      ? "pending_review"
      : "rejected";

    await pool.query(`
      UPDATE content_drafts SET
        score_quality = $1, score_relevancy = $2, score_toxicity = $3,
        score_compliance = $4, score_brand_tone = $5,
        scoring_model = $6, scoring_notes = $7, status = $8, updated_at = NOW()
      WHERE id = $9
    `, [
      scores.score_quality, scores.score_relevancy, scores.score_toxicity,
      scores.score_compliance, scores.score_brand_tone,
      process.env.CONTENT_SCORING_MODEL || "claude-haiku-4-5-20251001",
      JSON.stringify(notes), nextStatus, draft_id,
    ]);

    if (nextStatus === "pending_review") {
      await pool.query(
        "UPDATE content_briefs SET status = 'ready_review', updated_at = NOW() WHERE id = $1",
        [brief_id]
      );
      await contentReviewNotify.trigger({ draft_id, brief_id });
      logger.info("draft ready for review", { draft_id, score: scores.score_quality });
    } else {
      logger.warn("draft rejected by scoring", { draft_id, score: scores.score_quality, flags: notes.flags });
    }

    await pool.end();
    return { draft_id, nextStatus, scores };
  },
});

// ── content-review-notify ─────────────────────────────────────────────────────
// Sends reviewer notification email. 60-second timeout, 1 retry.

export const contentReviewNotify = task({
  id: "content-review-notify",
  maxDuration: 60,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 2_000 },
  run: async (payload) => {
    const { draft_id, brief_id, reviewer_email } = payload;

    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });

    const email = reviewer_email || process.env.CONTENT_REVIEWER_EMAIL;

    if (!email) {
      logger.warn("No reviewer email configured — skipping notify", { draft_id });
      return { skipped: true };
    }

    const mailerooApiKey = process.env.MAILEROO_API_KEY;
    if (!mailerooApiKey) {
      logger.warn("MAILEROO_API_KEY not set — skipping notify");
      return { skipped: true };
    }

    const body = [
      `A content draft is ready for your review.`,
      ``,
      `Draft ID : ${draft_id}`,
      `Brief ID : ${brief_id}`,
      ``,
      `Log into the content dashboard to review and approve.`,
    ].join("\n");

    const res = await fetch("https://smtp.maileroo.com/send", {
      method: "POST",
      headers: { "X-API-Key": mailerooApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAILEROO_FROM_EMAIL || "noreply@skynpatch.com",
        to: email,
        subject: "Content Draft Ready for Review",
        plain: body,
      }),
    });

    const result = await res.json();
    const messageId = result?.data?.message_id || result?.message_id || null;
    logger.info("reviewer notified", { email, messageId });

    return { email, messageId };
  },
});

// ── content-variant-publish ───────────────────────────────────────────────────
// Dispatches an approved variant to its channel adapter. 3-minute timeout.

export const contentVariantPublish = task({
  id: "content-variant-publish",
  maxDuration: 180,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 3_000 },
  run: async (payload) => {
    const { variant_id } = payload;

    logger.info("content-variant-publish starting", { variant_id });

    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });

    // dispatchVariant is loaded at runtime (channel adapters may have optional
    // deps like @octokit/rest that are installed on the worker but not bundled)
    const { dispatchVariant } = require("../scripts/content-publish");
    await dispatchVariant(variant_id, false);

    logger.info("variant published", { variant_id });
    return { variant_id, published: true };
  },
});

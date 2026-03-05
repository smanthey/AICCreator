#!/usr/bin/env node
/**
 * content-draft-generate.js — content:draft CLI hook + task handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches a content brief, calls the LLM, stores the draft, and queues scoring.
 * Can be run directly (CLI) or called by the content worker.
 *
 * Usage:
 *   node scripts/content-draft-generate.js --brief-id <uuid>
 *   node scripts/content-draft-generate.js --brief-id <uuid> --model claude-sonnet-4-5 --dry-run
 */
"use strict";

const { Pool }     = require("pg");
const path         = require("path");
const modelRouter  = require("../infra/model-router");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host:     process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
  port:     parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
  user:     process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
});

// ── Channel-specific system prompts ───────────────────────────────────────────
const CHANNEL_INSTRUCTIONS = {
  email: `You are writing a B2B marketing email for wholesale buyers.
Output JSON with: { "subject_line": "...", "preview_text": "...", "body_md": "...", "cta_text": "...", "cta_url_placeholder": "..." }
Keep subject under 60 chars. Preview text under 90 chars. Body should be scannable with headers.`,

  sms: `You are writing an SMS message for B2B wholesale buyers. 160 chars max.
Output JSON with: { "body_md": "...", "character_count": N }
Be direct, add value, include a single action.`,

  blog: `You are writing a B2B blog post.
Output JSON with: { "headline": "...", "preview_text": "...", "body_md": "...", "cta_text": "...", "cta_url_placeholder": "..." }
Use H2/H3 headers. Include a clear value proposition in the first paragraph.`,

  instagram: `You are writing an Instagram caption for a B2B brand.
Output JSON with: { "body_md": "...", "hashtags": ["..."], "cta_text": "...", "image_prompt": "..." }
Use line breaks for readability. Max 2200 chars.`,

  linkedin: `You are writing a LinkedIn post for a B2B wellness brand.
Output JSON with: { "headline": "...", "body_md": "...", "cta_text": "..." }
Professional tone. Lead with an insight or stat. Max 3000 chars.`,

  push_notification: `You are writing a push notification.
Output JSON with: { "subject_line": "...", "body_md": "...", "cta_text": "..." }
Title under 50 chars. Body under 100 chars.`,
};

// ── Core generation ───────────────────────────────────────────────────────────

async function generateDraft(brief, opts = {}) {
  const preferredModel = opts.model || process.env.CONTENT_DRAFT_MODEL || "";
  const forceModelKey = preferredModel && modelRouter.MODELS?.[preferredModel] ? preferredModel : undefined;
  const channelInstr = CHANNEL_INSTRUCTIONS[brief.channel] || CHANNEL_INSTRUCTIONS.email;

  const userPrompt = [
    `Brand: ${brief.brand_name || brief.brand_slug}`,
    `Channel: ${brief.channel}`,
    `Topic: ${brief.topic}`,
    brief.target_audience ? `Target audience: ${brief.target_audience}` : "",
    brief.tone            ? `Tone: ${brief.tone}` : "",
    brief.goal            ? `Goal: ${brief.goal}` : "",
    brief.keywords?.length ? `Keywords: ${brief.keywords.join(", ")}` : "",
    brief.max_length_words ? `Max length: ~${brief.max_length_words} words` : "",
  ].filter(Boolean).join("\n");

  const startMs = Date.now();
  const llm = await modelRouter.chatJson(
    "website_content_generator",
    channelInstr,
    userPrompt,
    {
      max_tokens: 2048,
      task_id: opts.task_id || `content-draft:${brief.id}`,
      force_model: forceModelKey,
    }
  );
  const generationMs = Date.now() - startMs;

  let parsed = llm.json;
  if (!parsed || typeof parsed !== "object") {
    const rawText = llm.text || "{}";
    try {
      const cleaned = rawText.replace(/^```json?\n?/i, "").replace(/\n?```$/, "");
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { body_md: rawText };
    }
  }

  return {
    parsed,
    tokensInput: llm.tokens_in || 0,
    tokensOutput: llm.tokens_out || 0,
    model: llm.model_id || llm.model_key || preferredModel || "routed",
    generationMs,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get  = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i+1] : null; };
  const has  = (f) => args.includes(f);

  const briefId       = get("--brief-id");
  const modelOverride = get("--model");
  const variantNum    = parseInt(get("--variant") || "1", 10);
  const dryRun        = has("--dry-run");

  if (!briefId) {
    console.error("❌ --brief-id is required");
    process.exit(1);
  }

  // Load brief + brand
  const { rows } = await pool.query(`
    SELECT cb.*, b.slug AS brand_slug, b.name AS brand_name
    FROM   content_briefs cb
    JOIN   brands b ON b.id = cb.brand_id
    WHERE  cb.id = $1
  `, [briefId]);

  if (!rows.length) {
    console.error(`❌ Brief not found: ${briefId}`);
    process.exit(1);
  }
  const brief = rows[0];

  console.log(`📝 Generating draft for brief: ${briefId}`);
  console.log(`   Channel : ${brief.channel}`);
  console.log(`   Topic   : ${brief.topic}`);

  if (dryRun) {
    console.log("── DRY RUN — would call LLM with:");
    console.log(JSON.stringify({ briefId, channel: brief.channel, model: modelOverride }, null, 2));
    await pool.end();
    return;
  }

  // Generate
  const { parsed, tokensInput, tokensOutput, model, generationMs } = await generateDraft(brief, {
    model: modelOverride,
  });

  // Set status → generating while we write
  await pool.query(
    "UPDATE content_briefs SET status = 'in_draft', updated_at = NOW() WHERE id = $1 AND status = 'pending'",
    [briefId]
  );

  // Insert draft
  const { rows: [draftRow] } = await pool.query(`
    INSERT INTO content_drafts (
      brief_id, variant_number, model_used, tokens_input, tokens_output, generation_ms,
      body_md, subject_line, preview_text, headline, cta_text, cta_url, image_prompt,
      status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'scoring')
    ON CONFLICT (brief_id, variant_number) DO UPDATE SET
      model_used    = EXCLUDED.model_used,
      tokens_input  = EXCLUDED.tokens_input,
      tokens_output = EXCLUDED.tokens_output,
      generation_ms = EXCLUDED.generation_ms,
      body_md       = EXCLUDED.body_md,
      subject_line  = EXCLUDED.subject_line,
      preview_text  = EXCLUDED.preview_text,
      headline      = EXCLUDED.headline,
      cta_text      = EXCLUDED.cta_text,
      cta_url       = EXCLUDED.cta_url,
      image_prompt  = EXCLUDED.image_prompt,
      status        = 'scoring',
      updated_at    = NOW()
    RETURNING id
  `, [
    briefId, variantNum, model, tokensInput, tokensOutput, generationMs,
    parsed.body_md     || null,
    parsed.subject_line|| null,
    parsed.preview_text|| null,
    parsed.headline    || null,
    parsed.cta_text    || null,
    parsed.cta_url_placeholder || null,
    parsed.image_prompt|| null,
  ]);

  // Queue scoring task
  await pool.query(`
    INSERT INTO tasks (type, payload, status, worker_tag, priority)
    VALUES ('content_draft_score', $1, 'pending', 'content', 50)
  `, [JSON.stringify({ draft_id: draftRow.id, brief_id: briefId })]);

  console.log(`✅ Draft created`);
  console.log(`   Draft ID      : ${draftRow.id}`);
  console.log(`   Model         : ${model}`);
  console.log(`   Tokens in/out : ${tokensInput}/${tokensOutput}`);
  console.log(`   Generation    : ${generationMs}ms`);
  console.log(`   Scoring task  : queued`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  pool.end().catch(() => {});
  process.exit(1);
});

// ── Export for worker use ─────────────────────────────────────────────────────
module.exports = { generateDraft };

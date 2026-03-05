#!/usr/bin/env node
/**
 * content-draft-score.js — content:score CLI hook + task handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores a content draft using an LLM-as-judge rubric (G-Eval style, no
 * external DeepEval dependency required — works with your existing Anthropic SDK).
 *
 * Scores produced (all 0.000–1.000):
 *   score_quality     — overall quality
 *   score_relevancy   — on-topic vs brief goal
 *   score_toxicity    — lower = more toxic (0 = clean)
 *   score_compliance  — brand/legal compliance
 *   score_brand_tone  — matches brief tone instruction
 *
 * Auto-advances draft:
 *   score_quality >= QUALITY_THRESHOLD  → status = 'pending_review'
 *   else                                → status = 'rejected' (triggers retry)
 *
 * Usage:
 *   node scripts/content-draft-score.js --draft-id <uuid>
 *   node scripts/content-draft-score.js --draft-id <uuid> --dry-run
 */
"use strict";

const { Pool }   = require("pg");
const path       = require("path");
const modelRouter = require("../infra/model-router");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host:     process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
  port:     parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
  user:     process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
});

// ── Threshold config ──────────────────────────────────────────────────────────
const QUALITY_THRESHOLD = parseFloat(process.env.CONTENT_QUALITY_THRESHOLD || "0.65");
const SCORING_MODEL     = process.env.CONTENT_SCORING_MODEL || "claude-haiku-4-5-20251001";

// ── G-Eval rubric ─────────────────────────────────────────────────────────────

const SCORING_PROMPT = `You are an expert content quality evaluator. Score this content draft.

BRIEF CONTEXT:
Channel: {channel}
Topic: {topic}
Audience: {audience}
Tone requested: {tone}
Goal: {goal}

CONTENT:
Subject/Headline: {subject_line}
Body:
{body_md}

Evaluate on these dimensions and return ONLY valid JSON:
{
  "score_quality":     0.0-1.0,  // overall quality, clarity, polish
  "score_relevancy":   0.0-1.0,  // how well it addresses the topic and goal
  "score_toxicity":    0.0-1.0,  // 0=clean, 1=very toxic/harmful (lower is better)
  "score_compliance":  0.0-1.0,  // legal/brand safety (no false claims, no spam triggers)
  "score_brand_tone":  0.0-1.0,  // matches the requested tone
  "reasoning": {
    "quality":    "one sentence",
    "relevancy":  "one sentence",
    "toxicity":   "one sentence",
    "compliance": "one sentence",
    "tone":       "one sentence"
  },
  "flags": []  // array of issue strings if any, empty if clean
}

Be strict. A score of 0.7 means "good but could be improved". 1.0 means "excellent".`;

async function scoreDraft(draft, brief) {
  const forceModelKey = SCORING_MODEL && modelRouter.MODELS?.[SCORING_MODEL] ? SCORING_MODEL : undefined;
  const prompt = SCORING_PROMPT
    .replace("{channel}",      brief.channel    || "email")
    .replace("{topic}",        brief.topic      || "")
    .replace("{audience}",     brief.target_audience || "general")
    .replace("{tone}",         brief.tone       || "professional")
    .replace("{goal}",         brief.goal       || "")
    .replace("{subject_line}", draft.subject_line || draft.headline || "(none)")
    .replace("{body_md}",      draft.body_md    || "(empty)");

  const llm = await modelRouter.chatJson(
    "analyze_content",
    "Return strict JSON only. Do not include markdown fences or extra prose.",
    prompt,
    {
      max_tokens: 1024,
      task_id: `content-score:${draft.id}`,
      force_model: forceModelKey,
      json_mode: true,
    }
  );

  let parsed = llm.json;
  if (!parsed || typeof parsed !== "object") {
    const rawText = llm.text || "{}";
    const cleaned = rawText.replace(/^```json?\n?/i, "").replace(/\n?```$/, "");
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        score_quality: 0.5, score_relevancy: 0.5, score_toxicity: 0.0,
        score_compliance: 0.5, score_brand_tone: 0.5,
        reasoning: { quality: "parse error" }, flags: ["scoring_parse_error"],
      };
    }
  }

  return {
    scores: {
      score_quality:    Math.max(0, Math.min(1, Number(parsed.score_quality    || 0.5))),
      score_relevancy:  Math.max(0, Math.min(1, Number(parsed.score_relevancy  || 0.5))),
      score_toxicity:   Math.max(0, Math.min(1, Number(parsed.score_toxicity   || 0.0))),
      score_compliance: Math.max(0, Math.min(1, Number(parsed.score_compliance || 0.5))),
      score_brand_tone: Math.max(0, Math.min(1, Number(parsed.score_brand_tone || 0.5))),
    },
    notes: { reasoning: parsed.reasoning, flags: parsed.flags || [] },
    tokensUsed: (llm.tokens_in || 0) + (llm.tokens_out || 0),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get  = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i+1] : null; };
  const has  = (f) => args.includes(f);

  const draftId = get("--draft-id");
  const dryRun  = has("--dry-run");

  if (!draftId) {
    console.error("❌ --draft-id is required");
    process.exit(1);
  }

  // Load draft + brief
  const { rows } = await pool.query(`
    SELECT cd.*, cb.channel, cb.topic, cb.target_audience, cb.tone, cb.goal, cb.brand_id
    FROM   content_drafts cd
    JOIN   content_briefs cb ON cb.id = cd.brief_id
    WHERE  cd.id = $1
  `, [draftId]);

  if (!rows.length) {
    console.error(`❌ Draft not found: ${draftId}`);
    process.exit(1);
  }
  const draft = rows[0];

  console.log(`🔍 Scoring draft: ${draftId}`);
  console.log(`   Channel : ${draft.channel}`);
  console.log(`   Topic   : ${draft.topic}`);

  if (dryRun) {
    console.log("── DRY RUN — would score with G-Eval rubric");
    await pool.end();
    return;
  }

  const { scores, notes, tokensUsed } = await scoreDraft(draft, draft);

  // Determine next status
  const approved     = scores.score_quality >= QUALITY_THRESHOLD && scores.score_toxicity < 0.3;
  const nextStatus   = approved ? "pending_review" : "rejected";

  // Update draft
  await pool.query(`
    UPDATE content_drafts SET
      score_quality    = $1,
      score_relevancy  = $2,
      score_toxicity   = $3,
      score_compliance = $4,
      score_brand_tone = $5,
      scoring_model    = $6,
      scoring_notes    = $7,
      status           = $8,
      updated_at       = NOW()
    WHERE id = $9
  `, [
    scores.score_quality, scores.score_relevancy, scores.score_toxicity,
    scores.score_compliance, scores.score_brand_tone,
    SCORING_MODEL, JSON.stringify(notes), nextStatus, draftId,
  ]);

  // If approved, update the brief status too
  if (approved) {
    await pool.query(`
      UPDATE content_briefs SET status = 'ready_review', updated_at = NOW()
      WHERE id = $1 AND status IN ('in_draft','pending')
    `, [draft.brief_id]);

    // Queue reviewer notification
    await pool.query(`
      INSERT INTO tasks (type, payload, status, worker_tag, priority)
      VALUES ('content_review_notify', $1, 'pending', 'content', 40)
    `, [JSON.stringify({ draft_id: draftId, brief_id: draft.brief_id })]);
  } else {
    console.log(`⚠  Draft scored below threshold (${scores.score_quality.toFixed(3)} < ${QUALITY_THRESHOLD}) — status: rejected`);
    if (notes.flags?.length) console.log(`   Flags: ${notes.flags.join(", ")}`);
  }

  console.log(`✅ Scoring complete`);
  console.log(`   Quality    : ${scores.score_quality.toFixed(3)}`);
  console.log(`   Relevancy  : ${scores.score_relevancy.toFixed(3)}`);
  console.log(`   Toxicity   : ${scores.score_toxicity.toFixed(3)}`);
  console.log(`   Compliance : ${scores.score_compliance.toFixed(3)}`);
  console.log(`   Brand tone : ${scores.score_brand_tone.toFixed(3)}`);
  console.log(`   Next status: ${nextStatus}`);
  console.log(`   Tokens     : ${tokensUsed}`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  pool.end().catch(() => {});
  process.exit(1);
});

module.exports = { scoreDraft };

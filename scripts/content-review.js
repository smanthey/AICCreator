#!/usr/bin/env node
/**
 * content-review.js — content:review CLI hook
 * -----------------------------------------------------------------------------
 * Resolves drafts in `pending_review` status into final decisions.
 *
 * Default decision logic:
 * - approve if quality >= threshold, compliance >= threshold, toxicity <= max,
 *   and brand tone >= threshold
 * - otherwise reject
 *
 * Usage:
 *   node scripts/content-review.js
 *   node scripts/content-review.js --limit 50
 *   node scripts/content-review.js --draft-id <uuid>
 *   node scripts/content-review.js --approve-threshold 0.72 --toxicity-max 0.2
 *   node scripts/content-review.js --dry-run
 */
"use strict";

const path = require("path");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
  port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
  user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
});

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(v, d = 3) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

function loadConfig() {
  const approveThreshold = clamp(num(arg("--approve-threshold", process.env.CONTENT_REVIEW_APPROVE_THRESHOLD || "0.7"), 0.7), 0, 1);
  const complianceThreshold = clamp(num(arg("--compliance-threshold", process.env.CONTENT_REVIEW_COMPLIANCE_THRESHOLD || String(approveThreshold)), approveThreshold), 0, 1);
  const toneThreshold = clamp(num(arg("--tone-threshold", process.env.CONTENT_REVIEW_TONE_THRESHOLD || "0.6"), 0.6), 0, 1);
  const toxicityMax = clamp(num(arg("--toxicity-max", process.env.CONTENT_REVIEW_TOXICITY_MAX || "0.25"), 0.25), 0, 1);
  const limit = Math.max(1, Math.min(500, parseInt(arg("--limit", "25"), 10) || 25));
  const draftId = String(arg("--draft-id", "") || "").trim();
  const dryRun = has("--dry-run");

  return {
    approveThreshold,
    complianceThreshold,
    toneThreshold,
    toxicityMax,
    limit,
    draftId,
    dryRun,
  };
}

function evaluateDecision(row, cfg) {
  const quality = Number(row.score_quality || 0);
  const compliance = Number(row.score_compliance || 0);
  const tone = Number(row.score_brand_tone || 0);
  const toxicity = Number(row.score_toxicity || 0);

  const reasons = [];
  if (quality < cfg.approveThreshold) reasons.push(`quality ${round(quality)} < ${cfg.approveThreshold}`);
  if (compliance < cfg.complianceThreshold) reasons.push(`compliance ${round(compliance)} < ${cfg.complianceThreshold}`);
  if (tone < cfg.toneThreshold) reasons.push(`tone ${round(tone)} < ${cfg.toneThreshold}`);
  if (toxicity > cfg.toxicityMax) reasons.push(`toxicity ${round(toxicity)} > ${cfg.toxicityMax}`);

  if (reasons.length > 0) {
    return {
      decision: "rejected",
      reason: reasons.join("; "),
      quality,
      compliance,
      tone,
      toxicity,
    };
  }

  return {
    decision: "approved",
    reason: "meets review thresholds",
    quality,
    compliance,
    tone,
    toxicity,
  };
}

async function fetchDrafts(cfg) {
  if (cfg.draftId) {
    const { rows } = await pool.query(
      `SELECT cd.id, cd.brief_id, cd.status, cd.variant_number, cd.subject_line,
              cd.score_quality, cd.score_relevancy, cd.score_toxicity, cd.score_compliance, cd.score_brand_tone,
              cb.channel, cb.topic, b.slug AS brand_slug
         FROM content_drafts cd
         JOIN content_briefs cb ON cb.id = cd.brief_id
         JOIN brands b ON b.id = cb.brand_id
        WHERE cd.id = $1
        LIMIT 1`,
      [cfg.draftId]
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT cd.id, cd.brief_id, cd.status, cd.variant_number, cd.subject_line,
            cd.score_quality, cd.score_relevancy, cd.score_toxicity, cd.score_compliance, cd.score_brand_tone,
            cb.channel, cb.topic, b.slug AS brand_slug
       FROM content_drafts cd
       JOIN content_briefs cb ON cb.id = cd.brief_id
       JOIN brands b ON b.id = cb.brand_id
      WHERE cd.status = 'pending_review'
      ORDER BY cd.updated_at ASC NULLS FIRST, cd.created_at ASC
      LIMIT $1`,
    [cfg.limit]
  );
  return rows;
}

async function applyDecision(row, evalResult, cfg) {
  if (cfg.dryRun) return;

  const reviewNotes = {
    reviewed_at: new Date().toISOString(),
    reviewer: "content-review-cli",
    decision: evalResult.decision,
    reason: evalResult.reason,
    scores: {
      quality: round(evalResult.quality),
      compliance: round(evalResult.compliance),
      tone: round(evalResult.tone),
      toxicity: round(evalResult.toxicity),
    },
    thresholds: {
      approve: cfg.approveThreshold,
      compliance: cfg.complianceThreshold,
      tone: cfg.toneThreshold,
      toxicity_max: cfg.toxicityMax,
    },
  };

  await pool.query(
    `UPDATE content_drafts
        SET status = $2,
            scoring_notes = COALESCE(scoring_notes, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [row.id, evalResult.decision, JSON.stringify({ content_review: reviewNotes })]
  );

  if (evalResult.decision === "approved") {
    await pool.query(
      `UPDATE content_briefs
          SET status = 'approved', updated_at = NOW()
        WHERE id = $1`,
      [row.brief_id]
    );
  } else {
    await pool.query(
      `UPDATE content_briefs
          SET status = 'in_draft', updated_at = NOW()
        WHERE id = $1 AND status IN ('ready_review','approved')`,
      [row.brief_id]
    );

    await pool.query(
      `INSERT INTO tasks (type, payload, status, worker_tag, priority)
       VALUES ('content_draft_generate', $1::jsonb, 'pending', 'content', 55)`,
      [JSON.stringify({ brief_id: row.brief_id, source: "content_review_auto_reject" })]
    );
  }
}

async function main() {
  const cfg = loadConfig();
  const rows = await fetchDrafts(cfg);

  if (!rows.length) {
    console.log(JSON.stringify({ ok: true, reviewed: 0, message: "no drafts found" }, null, 2));
    return;
  }

  const out = {
    ok: true,
    dry_run: cfg.dryRun,
    reviewed: rows.length,
    approved: 0,
    rejected: 0,
    thresholds: {
      approve: cfg.approveThreshold,
      compliance: cfg.complianceThreshold,
      tone: cfg.toneThreshold,
      toxicity_max: cfg.toxicityMax,
    },
    decisions: [],
  };

  for (const row of rows) {
    if (!cfg.draftId && row.status !== "pending_review") continue;

    const evalResult = evaluateDecision(row, cfg);
    if (evalResult.decision === "approved") out.approved += 1;
    else out.rejected += 1;

    out.decisions.push({
      draft_id: row.id,
      brief_id: row.brief_id,
      brand_slug: row.brand_slug,
      channel: row.channel,
      topic: row.topic,
      decision: evalResult.decision,
      reason: evalResult.reason,
      scores: {
        quality: round(evalResult.quality),
        compliance: round(evalResult.compliance),
        tone: round(evalResult.tone),
        toxicity: round(evalResult.toxicity),
      },
    });

    await applyDecision(row, evalResult, cfg);
  }

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((err) => {
    console.error("[content-review] fatal:", err.message || String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });

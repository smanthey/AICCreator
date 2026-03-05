#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const caseId = getArg("--case-id");
const issueType = getArg("--issue-type");
const strategy = getArg("--strategy");
const strategyMode = getArg("--strategy-mode");
const examiner = getArg("--examiner");
const result = getArg("--result");
const cycles = getArg("--cycles");
const days = getArg("--days");
const resolvedAt = getArg("--resolved-at");
const notes = getArg("--notes");
const classNumber = getArg("--class-number");
const markCategory = getArg("--mark-category");
const similarityScore = getArg("--similarity-score");
const goodsOverlapScore = getArg("--goods-overlap-score");
const marketplaceOverlapScore = getArg("--marketplace-overlap-score");
const markStrengthScore = getArg("--mark-strength-score");
const priorRegStrengthScore = getArg("--prior-reg-strength-score");
const examinerStrictness = getArg("--examiner-strictness-index");
const borderlineClass = getArg("--borderline-classification");
const borderlineConfidence = getArg("--borderline-confidence");
const scopeShrinkDelta = getArg("--scope-shrink-delta");
const scopeShrinkRatio = getArg("--scope-shrink-ratio");
const scopePenalty = getArg("--scope-penalty");
const feePenalty = getArg("--fee-penalty");

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!caseId || !result) {
    throw new Error("Required: --case-id <uuid> --result <accepted|partial_refusal|final_refusal|abandoned|other>");
  }

  await pg.query(
    `INSERT INTO ip_case_outcomes
      (case_id, issue_type, response_strategy_used, strategy_mode, examiner, result, cycles_to_resolution, time_to_resolution_days, resolved_at, notes,
       class_number, mark_category, similarity_score, goods_overlap_score, marketplace_overlap_score, mark_strength_score,
       prior_registration_strength_score, examiner_strictness_index, borderline_classification, borderline_confidence,
       scope_shrink_delta, scope_shrink_ratio, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,
             $21,$22,$23::jsonb)`,
    [
      caseId,
      issueType || null,
      strategy || null,
      strategyMode || null,
      examiner || null,
      result,
      cycles ? Number(cycles) : null,
      days ? Number(days) : null,
      resolvedAt || null,
      notes || null,
      classNumber ? Number(classNumber) : null,
      markCategory || null,
      numOrNull(similarityScore),
      numOrNull(goodsOverlapScore),
      numOrNull(marketplaceOverlapScore),
      numOrNull(markStrengthScore),
      numOrNull(priorRegStrengthScore),
      numOrNull(examinerStrictness),
      borderlineClass || null,
      numOrNull(borderlineConfidence),
      numOrNull(scopeShrinkDelta) ?? 0,
      numOrNull(scopeShrinkRatio) ?? 0,
      JSON.stringify({
        scope_reduction_penalty: numOrNull(scopePenalty) ?? 0,
        fee_penalty: numOrNull(feePenalty) ?? 0,
      }),
    ]
  );

  console.log(`[ip-log-outcome] saved case=${caseId} result=${result}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

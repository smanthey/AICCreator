"use strict";

const pg = require("../../infra/postgres");

const BROAD_TERMS = [
  "goods",
  "services",
  "software",
  "platform",
  "app",
  "application",
  "retail",
  "consulting",
  "solutions",
  "technology",
  "products",
  "all",
  "various",
  "including",
];

const DESCRIPTIVE_HINTS = [
  "shop",
  "store",
  "app",
  "pay",
  "tax",
  "cloud",
  "ai",
  "video",
  "design",
  "service",
  "pro",
  "smart",
  "quick",
  "best",
];

function clamp01(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round4(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 10000) / 10000;
}

function tokenizeMark(mark) {
  return String(mark || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  const as = new Set(a);
  const bs = new Set(b);
  if (!as.size && !bs.size) return 0;
  const intersection = [...as].filter((x) => bs.has(x)).length;
  const union = new Set([...as, ...bs]).size;
  return union > 0 ? intersection / union : 0;
}

function overlapClasses(targetClasses, existingClasses) {
  const t = new Set(targetClasses || []);
  const e = new Set(existingClasses || []);
  if (!t.size || !e.size) return 0;
  const inter = [...t].filter((x) => e.has(x)).length;
  return inter / Math.max(1, Math.min(t.size, e.size));
}

function textSpecificity(goodsText) {
  const text = String(goodsText || "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0.4;
  const broadHits = BROAD_TERMS.filter((t) => text.includes(t)).length;
  const broadRatio = broadHits / BROAD_TERMS.length;
  const shortPenalty = words.length < 8 ? 0.2 : 0;
  return clamp01(0.8 - broadRatio - shortPenalty);
}

function markDescriptiveScore(markText) {
  const text = String(markText || "").toLowerCase();
  const hits = DESCRIPTIVE_HINTS.filter((t) => text.includes(t)).length;
  return clamp01(hits / Math.max(4, DESCRIPTIVE_HINTS.length / 2));
}

function classifyBorderline(similarity, goodsOverlap) {
  if (similarity >= 0.75 && goodsOverlap >= 0.7) return { cls: "clear_conflict", confidence: 0.85 };
  if (similarity <= 0.35 && goodsOverlap <= 0.35) return { cls: "clear_distinguishable", confidence: 0.8 };
  return { cls: "borderline", confidence: 0.72 };
}

function scoreToCycles(risk2d, risk2e1, riskId, riskSpecimen) {
  const composite = (risk2d * 0.45) + (risk2e1 * 0.2) + (riskId * 0.2) + (riskSpecimen * 0.15);
  if (composite < 0.35) return 1;
  if (composite < 0.65) return 2;
  return 3;
}

function strategyOptions({
  risk2d,
  risk2e1,
  riskId,
  riskSpecimen,
  predictedCycles,
  shouldSplit,
}) {
  const options = [];

  options.push({
    key: "S1_file_as_is",
    label: "File as-is",
    expected_cycles: Math.max(1, predictedCycles),
    expected_months: Math.max(6, predictedCycles * 4),
    expected_fee_multiplier: 1.0,
    scope_impact: 0,
    fit: round4(clamp01(1 - ((risk2d * 0.5) + (riskId * 0.3) + (risk2e1 * 0.2)))),
  });

  options.push({
    key: "S2_narrow_id",
    label: "Narrow ID pre-filing",
    expected_cycles: Math.max(1, predictedCycles - 1),
    expected_months: Math.max(5, (predictedCycles - 0.6) * 4),
    expected_fee_multiplier: 1.0,
    scope_impact: round4(0.1 + (riskId * 0.2) + (risk2d * 0.1)),
    fit: round4(clamp01((riskId * 0.45) + (risk2d * 0.35) + 0.2)),
  });

  options.push({
    key: "S3_split_classes_early",
    label: "Split classes early",
    expected_cycles: Math.max(1, predictedCycles - (shouldSplit ? 1 : 0)),
    expected_months: Math.max(5, predictedCycles * 3.6),
    expected_fee_multiplier: shouldSplit ? 1.35 : 1.15,
    scope_impact: 0,
    fit: round4(clamp01((shouldSplit ? 0.8 : 0.35) + (risk2d * 0.2))),
  });

  options.push({
    key: "S5_file_1b_then_specimen",
    label: "File 1(b), specimen later",
    expected_cycles: Math.max(1, predictedCycles),
    expected_months: Math.max(6, predictedCycles * 4.2),
    expected_fee_multiplier: 1.1,
    scope_impact: 0,
    fit: round4(clamp01((riskSpecimen * 0.7) + 0.2)),
  });

  options.sort((a, b) => b.fit - a.fit);
  return options;
}

async function loadClassProfiles(classNumbers) {
  if (!Array.isArray(classNumbers) || classNumbers.length === 0) return [];
  const { rows } = await pg.query(
    `SELECT class_number, acceptance_rate, avg_cycles, likelihood_2d_density, descriptiveness_2e1_rate, specimen_refusal_rate
     FROM ip_class_profiles
     WHERE class_number = ANY($1::int[])`,
    [classNumbers]
  );
  return rows;
}

async function loadCategoryProfile(category) {
  if (!category) return null;
  const { rows } = await pg.query(
    `SELECT category_name, acceptance_rate, avg_cycles, narrowing_success_rate, argument_success_rate, hybrid_success_rate
     FROM ip_category_profiles
     WHERE lower(category_name) = lower($1)
     LIMIT 1`,
    [category]
  );
  return rows[0] || null;
}

async function findConflictCandidates(markText, classNumbers, limit = 12) {
  const tokens = tokenizeMark(markText);
  if (!tokens.length) return [];

  const { rows } = await pg.query(
    `SELECT id, case_key, primary_mark_text, classes
     FROM ip_cases
     WHERE primary_mark_text IS NOT NULL
       AND length(primary_mark_text) > 0
     ORDER BY updated_at DESC
     LIMIT 2000`
  );

  const out = [];
  for (const row of rows) {
    const mark = String(row.primary_mark_text || "");
    const existingTokens = tokenizeMark(mark);
    if (!existingTokens.length) continue;

    const sim = jaccard(tokens, existingTokens);
    if (sim <= 0.2) continue;
    const classOverlap = overlapClasses(classNumbers, row.classes || []);
    const crowdWeight = (sim * 0.8) + (classOverlap * 0.2);

    out.push({
      case_id: row.id,
      case_key: row.case_key,
      mark,
      similarity: round4(sim),
      class_overlap: round4(classOverlap),
      crowd_weight: round4(crowdWeight),
    });
  }

  out.sort((a, b) => b.crowd_weight - a.crowd_weight);
  return out.slice(0, limit);
}

function classRiskSpread(classProfiles) {
  if (!classProfiles.length) return 0;
  const risks = classProfiles.map((r) => clamp01(Number(r.likelihood_2d_density || 0)));
  const max = Math.max(...risks);
  const min = Math.min(...risks);
  return clamp01(max - min);
}

async function assessPrefiling({ markText, goodsText, classNumbers, markCategory, filingBasis }) {
  const [classProfiles, categoryProfile, conflicts] = await Promise.all([
    loadClassProfiles(classNumbers),
    loadCategoryProfile(markCategory),
    findConflictCandidates(markText, classNumbers),
  ]);

  const similarityScore = conflicts.length
    ? conflicts.slice(0, 5).reduce((a, c) => a + c.similarity, 0) / Math.min(5, conflicts.length)
    : 0;
  const goodsOverlapScore = conflicts.length
    ? conflicts.slice(0, 5).reduce((a, c) => a + c.class_overlap, 0) / Math.min(5, conflicts.length)
    : 0;
  const crowdingScore = clamp01(conflicts.length / 12);
  const idSpecificityScore = textSpecificity(goodsText);
  const descriptiveMarkScore = markDescriptiveScore(markText);

  const class2dDensity = classProfiles.length
    ? classProfiles.reduce((a, r) => a + Number(r.likelihood_2d_density || 0), 0) / classProfiles.length
    : 0.35;
  const class2eRate = classProfiles.length
    ? classProfiles.reduce((a, r) => a + Number(r.descriptiveness_2e1_rate || 0), 0) / classProfiles.length
    : 0.25;
  const classSpecimenRate = classProfiles.length
    ? classProfiles.reduce((a, r) => a + Number(r.specimen_refusal_rate || 0), 0) / classProfiles.length
    : 0.2;

  const categoryArgRate = categoryProfile ? Number(categoryProfile.argument_success_rate || 0) : 0.4;
  const categoryNarrowRate = categoryProfile ? Number(categoryProfile.narrowing_success_rate || 0) : 0.4;

  const risk2d = clamp01((similarityScore * 0.45) + (goodsOverlapScore * 0.3) + (crowdingScore * 0.1) + (class2dDensity * 0.15));
  const risk2e1 = clamp01((descriptiveMarkScore * 0.55) + (class2eRate * 0.45));
  const riskId = clamp01((1 - idSpecificityScore) * 0.75 + 0.25);

  let riskSpecimen = clamp01(classSpecimenRate * 0.7 + 0.2);
  if (String(filingBasis || "").toLowerCase() === "1b") riskSpecimen = clamp01(riskSpecimen * 0.45);

  const predictedCycles = scoreToCycles(risk2d, risk2e1, riskId, riskSpecimen);
  const spread = classRiskSpread(classProfiles);
  const shouldSplit = classNumbers.length > 1 && (spread > 0.25 || risk2d > 0.65);

  const options = strategyOptions({
    risk2d,
    risk2e1,
    riskId,
    riskSpecimen,
    predictedCycles,
    shouldSplit,
  });

  let recommended = options[0]?.key || "S1_file_as_is";
  if (risk2d > 0.7 && categoryNarrowRate > categoryArgRate) recommended = shouldSplit ? "S3_split_classes_early" : "S2_narrow_id";
  if (riskSpecimen > 0.6 && String(filingBasis || "").toLowerCase() !== "1b") recommended = "S5_file_1b_then_specimen";

  const borderline = classifyBorderline(risk2d, goodsOverlapScore);

  const topDrivers = [
    { key: "similarity_score", value: round4(similarityScore) },
    { key: "goods_overlap_score", value: round4(goodsOverlapScore) },
    { key: "crowding_score", value: round4(crowdingScore) },
    { key: "id_specificity_score", value: round4(idSpecificityScore) },
    { key: "class_2d_density", value: round4(class2dDensity) },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 4);

  return {
    mark_text: markText,
    filing_basis: filingBasis || "unknown",
    class_numbers: classNumbers,
    mark_category: markCategory || null,
    goods_text: goodsText || null,
    id_specificity_score: round4(idSpecificityScore),
    crowding_score: round4(crowdingScore),
    similarity_score: round4(similarityScore),
    goods_overlap_score: round4(goodsOverlapScore),
    marketplace_overlap_score: round4(goodsOverlapScore),
    risk_2d: round4(risk2d),
    risk_2e1: round4(risk2e1),
    risk_id_indefinite: round4(riskId),
    risk_specimen: round4(riskSpecimen),
    predicted_cycles: predictedCycles,
    recommended_strategy: recommended,
    recommended_split: shouldSplit,
    strategy_options: options,
    top_drivers: topDrivers,
    conflict_candidates: conflicts,
    borderline_classification: borderline.cls,
    borderline_confidence: round4(borderline.confidence),
  };
}

async function saveAssessment(assessment) {
  const { rows } = await pg.query(
    `INSERT INTO ip_prefiling_assessments
      (mark_text, filing_basis, class_numbers, mark_category, goods_text,
       id_specificity_score, crowding_score, similarity_score, goods_overlap_score, marketplace_overlap_score,
       risk_2d, risk_2e1, risk_id_indefinite, risk_specimen, predicted_cycles,
       recommended_strategy, recommended_split, strategy_options_json, top_drivers_json, conflict_candidates_json)
     VALUES
      ($1,$2,$3::int[],$4,$5,
       $6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,
       $16,$17,$18::jsonb,$19::jsonb,$20::jsonb)
     RETURNING id, created_at`,
    [
      assessment.mark_text,
      assessment.filing_basis,
      assessment.class_numbers,
      assessment.mark_category,
      assessment.goods_text,
      assessment.id_specificity_score,
      assessment.crowding_score,
      assessment.similarity_score,
      assessment.goods_overlap_score,
      assessment.marketplace_overlap_score,
      assessment.risk_2d,
      assessment.risk_2e1,
      assessment.risk_id_indefinite,
      assessment.risk_specimen,
      assessment.predicted_cycles,
      assessment.recommended_strategy,
      assessment.recommended_split,
      JSON.stringify(assessment.strategy_options || []),
      JSON.stringify(assessment.top_drivers || []),
      JSON.stringify(assessment.conflict_candidates || []),
    ]
  );
  return rows[0];
}

module.exports = {
  assessPrefiling,
  saveAssessment,
};

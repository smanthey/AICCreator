#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

async function run(sql) {
  const { rowCount } = await pg.query(sql);
  return rowCount;
}

async function main() {
  await pg.query("BEGIN");

  if (!DRY_RUN) {
    await run("TRUNCATE ip_examiner_profiles RESTART IDENTITY");
    await run("TRUNCATE ip_class_profiles RESTART IDENTITY");
    await run("TRUNCATE ip_category_profiles RESTART IDENTITY");
    await run("TRUNCATE ip_borderline_matrix RESTART IDENTITY");
  }

  const examinerAggSql = `
    WITH x AS (
      SELECT
        examiner,
        COUNT(*)::int AS total_cases,
        AVG(CASE WHEN result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS acceptance_rate,
        AVG(NULLIF(cycles_to_resolution,0))::numeric(8,4) AS avg_cycles,
        AVG(NULLIF(time_to_resolution_days,0))::numeric(10,2) AS avg_days_to_resolution,
        AVG(CASE WHEN issue_type='specimen_refusal' THEN 1 ELSE 0 END)::numeric(8,4) AS specimen_rejection_rate,
        AVG(CASE WHEN strategy_mode='argue' AND result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS argument_success_rate,
        AVG(CASE WHEN strategy_mode='narrow' AND result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS narrowing_success_rate,
        AVG(CASE WHEN strategy_mode='hybrid' AND result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS hybrid_success_rate,
        AVG(CASE WHEN result IN ('final_refusal','abandoned') THEN 1 ELSE 0 END)::numeric(8,4) AS failure_rate
      FROM ip_case_outcomes
      WHERE examiner IS NOT NULL AND examiner <> ''
      GROUP BY examiner
    )
    INSERT INTO ip_examiner_profiles
      (examiner_name, total_cases, acceptance_rate, avg_cycles, avg_days_to_resolution,
       strictness_score, specimen_rejection_rate, argument_success_rate, narrowing_success_rate, hybrid_success_rate,
       updated_at, metadata_json)
    SELECT
      examiner,
      total_cases,
      COALESCE(acceptance_rate,0),
      COALESCE(avg_cycles,0),
      COALESCE(avg_days_to_resolution,0),
      LEAST(1.0, GREATEST(0.0, COALESCE(failure_rate,0) * 0.7 + CASE WHEN COALESCE(avg_cycles,0) > 1 THEN 0.3 ELSE 0 END))::numeric(8,4) AS strictness_score,
      COALESCE(specimen_rejection_rate,0),
      COALESCE(argument_success_rate,0),
      COALESCE(narrowing_success_rate,0),
      COALESCE(hybrid_success_rate,0),
      NOW(),
      jsonb_build_object('failure_rate', COALESCE(failure_rate,0))
    FROM x`;

  const classAggSql = `
    WITH x AS (
      SELECT
        class_number,
        COUNT(*)::int AS total_cases,
        AVG(CASE WHEN result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS acceptance_rate,
        AVG(NULLIF(cycles_to_resolution,0))::numeric(8,4) AS avg_cycles,
        AVG(NULLIF(time_to_resolution_days,0))::numeric(10,2) AS avg_days_to_resolution,
        AVG(CASE WHEN issue_type='likelihood_of_confusion_2d' THEN 1 ELSE 0 END)::numeric(8,4) AS likelihood_2d_density,
        AVG(CASE WHEN issue_type='descriptiveness_2e1' THEN 1 ELSE 0 END)::numeric(8,4) AS descriptiveness_2e1_rate,
        AVG(CASE WHEN issue_type='specimen_refusal' THEN 1 ELSE 0 END)::numeric(8,4) AS specimen_refusal_rate,
        AVG(CASE WHEN issue_type='disclaimer_requirement' THEN 1 ELSE 0 END)::numeric(8,4) AS disclaimer_rate
      FROM ip_case_outcomes
      WHERE class_number IS NOT NULL
      GROUP BY class_number
    )
    INSERT INTO ip_class_profiles
      (class_number, total_cases, acceptance_rate, avg_cycles, avg_days_to_resolution,
       likelihood_2d_density, descriptiveness_2e1_rate, specimen_refusal_rate, disclaimer_rate,
       updated_at, metadata_json)
    SELECT
      class_number,
      total_cases,
      COALESCE(acceptance_rate,0),
      COALESCE(avg_cycles,0),
      COALESCE(avg_days_to_resolution,0),
      COALESCE(likelihood_2d_density,0),
      COALESCE(descriptiveness_2e1_rate,0),
      COALESCE(specimen_refusal_rate,0),
      COALESCE(disclaimer_rate,0),
      NOW(),
      '{}'::jsonb
    FROM x`;

  const categoryAggSql = `
    WITH x AS (
      SELECT
        mark_category,
        COUNT(*)::int AS total_cases,
        AVG(CASE WHEN result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS acceptance_rate,
        AVG(NULLIF(cycles_to_resolution,0))::numeric(8,4) AS avg_cycles,
        AVG(NULLIF(time_to_resolution_days,0))::numeric(10,2) AS avg_days_to_resolution,
        AVG(CASE WHEN strategy_mode='narrow' AND result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS narrowing_success_rate,
        AVG(CASE WHEN strategy_mode='argue' AND result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS argument_success_rate,
        AVG(CASE WHEN strategy_mode='hybrid' AND result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS hybrid_success_rate
      FROM ip_case_outcomes
      WHERE mark_category IS NOT NULL AND mark_category <> ''
      GROUP BY mark_category
    )
    INSERT INTO ip_category_profiles
      (category_name, total_cases, acceptance_rate, avg_cycles, avg_days_to_resolution,
       narrowing_success_rate, argument_success_rate, hybrid_success_rate,
       updated_at, metadata_json)
    SELECT
      mark_category,
      total_cases,
      COALESCE(acceptance_rate,0),
      COALESCE(avg_cycles,0),
      COALESCE(avg_days_to_resolution,0),
      COALESCE(narrowing_success_rate,0),
      COALESCE(argument_success_rate,0),
      COALESCE(hybrid_success_rate,0),
      NOW(),
      '{}'::jsonb
    FROM x`;

  const matrixAggSql = `
    WITH base AS (
      SELECT
        COALESCE(issue_type,'unknown') AS issue_type,
        class_number,
        mark_category,
        examiner,
        CASE
          WHEN similarity_score IS NULL THEN 'unknown'
          WHEN similarity_score < 0.40 THEN 'low'
          WHEN similarity_score < 0.70 THEN 'mid'
          ELSE 'high'
        END AS similarity_band,
        CASE
          WHEN goods_overlap_score IS NULL THEN 'unknown'
          WHEN goods_overlap_score < 0.40 THEN 'low'
          WHEN goods_overlap_score < 0.70 THEN 'mid'
          ELSE 'high'
        END AS goods_overlap_band,
        CASE
          WHEN examiner_strictness_index IS NULL THEN 'unknown'
          WHEN examiner_strictness_index < 0.40 THEN 'low'
          WHEN examiner_strictness_index < 0.70 THEN 'mid'
          ELSE 'high'
        END AS strictness_band,
        COALESCE(strategy_mode,'other') AS strategy_mode,
        result,
        cycles_to_resolution,
        time_to_resolution_days,
        COALESCE(scope_shrink_ratio,0) AS scope_shrink_ratio,
        COALESCE((metadata_json->>'scope_reduction_penalty')::numeric,0) AS scope_penalty
      FROM ip_case_outcomes
      WHERE COALESCE(borderline_classification,'') = 'borderline'
    ),
    agg AS (
      SELECT
        issue_type,
        class_number,
        mark_category,
        examiner,
        similarity_band,
        goods_overlap_band,
        strictness_band,
        strategy_mode,
        COUNT(*)::int AS sample_size,
        AVG(CASE WHEN result='accepted' THEN 1 ELSE 0 END)::numeric(8,4) AS acceptance_rate,
        AVG(NULLIF(cycles_to_resolution,0))::numeric(8,4) AS avg_cycles,
        AVG(NULLIF(time_to_resolution_days,0))::numeric(10,2) AS avg_days_to_resolution,
        AVG(scope_penalty + scope_shrink_ratio)::numeric(10,4) AS scope_shrink_penalty
      FROM base
      GROUP BY issue_type, class_number, mark_category, examiner, similarity_band, goods_overlap_band, strictness_band, strategy_mode
    )
    INSERT INTO ip_borderline_matrix
      (issue_type, class_number, mark_category, examiner_name, similarity_band, goods_overlap_band, strictness_band,
       strategy_mode, sample_size, acceptance_rate, avg_cycles, avg_days_to_resolution, scope_shrink_penalty, score,
       updated_at, metadata_json)
    SELECT
      issue_type,
      class_number,
      mark_category,
      examiner,
      similarity_band,
      goods_overlap_band,
      strictness_band,
      strategy_mode,
      sample_size,
      COALESCE(acceptance_rate,0),
      COALESCE(avg_cycles,0),
      COALESCE(avg_days_to_resolution,0),
      COALESCE(scope_shrink_penalty,0),
      (
        (COALESCE(acceptance_rate,0) * 0.6)
        + ((1 / (1 + GREATEST(COALESCE(avg_cycles,0) - 1, 0))) * 0.3)
        - (COALESCE(scope_shrink_penalty,0) * 0.1)
      )::numeric(10,4) AS score,
      NOW(),
      '{}'::jsonb
    FROM agg`;

  let c1 = 0; let c2 = 0; let c3 = 0; let c4 = 0;
  if (!DRY_RUN) {
    c1 = await run(examinerAggSql);
    c2 = await run(classAggSql);
    c3 = await run(categoryAggSql);
    c4 = await run(matrixAggSql);
    await pg.query("COMMIT");
  } else {
    await pg.query("ROLLBACK");
  }

  console.log(`[ip-refresh-patterns] dry=${DRY_RUN} examiner_profiles=${c1} class_profiles=${c2} category_profiles=${c3} borderline_matrix=${c4}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    await pg.query("ROLLBACK").catch(() => {});
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const MAX_AGE_HOURS = Math.max(1, Number(getArg("--max-age-hours", process.env.GITHUB_BASELINE_MAX_AGE_HOURS || "48")) || 48);
const FEATURE_BENCHMARK_ENFORCE = String(process.env.FEATURE_BENCHMARK_ENFORCE || "true").toLowerCase() !== "false";
const FEATURE_BENCHMARK_MAX_AGE_HOURS = Math.max(
  1,
  Number(getArg("--benchmark-max-age-hours", process.env.FEATURE_BENCHMARK_GATE_MAX_AGE_HOURS || "48")) || 48
);
const TARGET_REPO = getArg("--repo", process.env.REPO_KEY || "local/claw-architect");

async function main() {
  const { rows: runRows } = await pg.query(
    `SELECT id, finished_at
     FROM github_repo_scan_runs
     WHERE status='completed'
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`
  );
  const run = runRows[0];
  if (!run) throw new Error("no_completed_scan_run");

  const { rows: ageRows } = await pg.query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - $1::timestamptz))/3600.0 AS age_h`,
    [run.finished_at]
  );
  const age = Number(ageRows[0]?.age_h || 9999);
  if (age > MAX_AGE_HOURS) throw new Error(`latest_scan_too_old:${age.toFixed(1)}h`);

  const { rows } = await pg.query(
    `SELECT repo_name, code, severity
     FROM github_repo_violations
     WHERE run_id = $1
       AND code IN ('AUTH_NOT_STANDARDIZED','MULTI_TENANT_BASELINE_MISSING','LEGACY_AUTH_RUNTIME_PRESENT')
       AND severity = 'critical'
     ORDER BY severity DESC, repo_name ASC`,
    [run.id]
  );

  console.log("\n=== GitHub Baseline Gate ===\n");
  console.log(`run_id: ${run.id}`);
  console.log(`age_h: ${age.toFixed(2)}`);
  console.log(`violations: ${rows.length}`);
  rows.slice(0, 50).forEach((r) => {
    console.log(`- [${r.severity}] ${r.repo_name}: ${r.code}`);
  });

  if (rows.length > 0) {
    process.exit(1);
  }

  if (FEATURE_BENCHMARK_ENFORCE) {
    const { rows: benchRows } = await pg.query(
      `WITH latest AS (
         SELECT DISTINCT ON (feature_key)
                feature_key, feature_label, feature_score, previous_score, delta_score, improved, created_at
           FROM public.feature_benchmark_scores
          WHERE repo_key = $1
            AND created_at >= NOW() - ($2::text || ' hours')::interval
          ORDER BY feature_key, created_at DESC
       )
       SELECT *
         FROM latest
        ORDER BY feature_key ASC`,
      [TARGET_REPO, String(FEATURE_BENCHMARK_MAX_AGE_HOURS)]
    );

    if (!benchRows.length) {
      throw new Error(`benchmark_missing:${TARGET_REPO}:age_h=${FEATURE_BENCHMARK_MAX_AGE_HOURS}`);
    }

    const regressions = benchRows.filter((r) => {
      const delta = Number(r.delta_score ?? 0);
      if (Number.isFinite(delta) && delta < -0.01) return true;
      if (r.delta_score == null && r.previous_score != null) {
        const score = Number(r.feature_score ?? 0);
        const prev = Number(r.previous_score ?? 0);
        return score < prev - 0.01;
      }
      return false;
    });
    console.log(`benchmark_rows: ${benchRows.length} repo=${TARGET_REPO}`);
    regressions.slice(0, 50).forEach((r) => {
      console.log(
        `- [benchmark_regression] ${r.feature_key} score=${Number(r.feature_score || 0).toFixed(2)} ` +
          `prev=${r.previous_score == null ? "n/a" : Number(r.previous_score).toFixed(2)} ` +
          `delta=${r.delta_score == null ? "n/a" : Number(r.delta_score).toFixed(2)}`
      );
    });
    if (regressions.length > 0) {
      throw new Error(`benchmark_regression_count:${regressions.length}`);
    }
  }
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("FAIL:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

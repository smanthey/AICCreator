#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pg = require("../infra/postgres");

const REPO = getArg("--repo", "local/claw-architect");
const FEATURE = getArg("--feature", null);
const RUN_ID = getArg("--run-id", null);
const SINCE_HOURS = Math.max(1, Number(getArg("--since-hours", process.env.FEATURE_BENCHMARK_GATE_MAX_AGE_HOURS || "48")) || 48);
const STRICT = String(process.env.FEATURE_BENCHMARK_GATE_STRICT || "true").toLowerCase() !== "false";

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = String(process.argv[i + 1] || "").trim();
  return v || fallback;
}

async function resolveLatestRows(repo, feature, runId, sinceHours) {
  if (runId) {
    const { rows } = await pg.query(
      `SELECT feature_key, feature_label, feature_score, previous_score, delta_score, improved, created_at
         FROM public.feature_benchmark_scores
        WHERE run_id = $1
          AND repo_key = $2
          AND ($3::text IS NULL OR feature_key = $3)
        ORDER BY feature_key ASC`,
      [runId, repo, feature]
    );
    return rows;
  }

  const { rows } = await pg.query(
    `WITH latest AS (
       SELECT DISTINCT ON (feature_key)
              feature_key, feature_label, feature_score, previous_score, delta_score, improved, created_at
         FROM public.feature_benchmark_scores
        WHERE repo_key = $1
          AND ($2::text IS NULL OR feature_key = $2)
          AND created_at >= NOW() - ($3::text || ' hours')::interval
        ORDER BY feature_key, created_at DESC
     )
     SELECT *
       FROM latest
      ORDER BY feature_key ASC`,
    [repo, feature, String(sinceHours)]
  );
  return rows;
}

async function main() {
  const rows = await resolveLatestRows(REPO, FEATURE, RUN_ID, SINCE_HOURS);
  if (!rows.length) {
    throw new Error(`benchmark_missing: repo=${REPO} feature=${FEATURE || "all"} since_h=${SINCE_HOURS}`);
  }

  const failures = rows.filter((r) => STRICT && !Boolean(r.improved));
  const report = {
    ok: failures.length === 0,
    repo: REPO,
    strict: STRICT,
    feature: FEATURE,
    run_id: RUN_ID,
    since_hours: SINCE_HOURS,
    checked: rows.length,
    failures: failures.length,
    rows: rows.map((r) => ({
      feature_key: r.feature_key,
      feature_label: r.feature_label,
      feature_score: Number(r.feature_score || 0),
      previous_score: r.previous_score == null ? null : Number(r.previous_score),
      delta_score: r.delta_score == null ? null : Number(r.delta_score),
      improved: Boolean(r.improved),
      created_at: r.created_at,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("[feature-benchmark-gate] FAIL:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");

async function section(title, sql, params = []) {
  const { rows } = await pg.query(sql, params);
  console.log(`\n${title}`);
  for (const r of rows) {
    console.log("- " + Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" | "));
  }
}

async function main() {
  console.log("\n=== Credit Learning Report ===\n");

  await section(
    "Win Rates by Issue + Action",
    `SELECT issue_type,
            action_type,
            SUM(CASE WHEN win THEN 1 ELSE 0 END)::int AS wins,
            COUNT(*)::int AS total,
            ROUND((SUM(CASE WHEN win THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0)), 3) AS win_rate
     FROM credit_learning_events
     GROUP BY issue_type, action_type
     ORDER BY win_rate DESC NULLS LAST, total DESC
     LIMIT 40`
  );

  await section(
    "Bureau Empirical Performance",
    `SELECT COALESCE(bureau,'unknown') AS bureau,
            ROUND(AVG(win_prob)::numeric, 3) AS avg_model_prob,
            ROUND((SUM(CASE WHEN win THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0)), 3) AS empirical_win_rate,
            COUNT(*)::int AS n
     FROM credit_learning_events
     GROUP BY COALESCE(bureau,'unknown')
     ORDER BY empirical_win_rate DESC NULLS LAST`
  );

  await section(
    "Severity Bucket vs Win Rate",
    `SELECT severity_bucket,
            ROUND((SUM(CASE WHEN win THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0)), 3) AS win_rate,
            COUNT(*)::int AS n
     FROM (
       SELECT (FLOOR(severity / 10.0) * 10)::int AS severity_bucket, win
       FROM credit_learning_events
     ) s
     GROUP BY severity_bucket
     ORDER BY severity_bucket`
  );

  await section(
    "Score Delta by Action Type",
    `SELECT action_type,
            ROUND(AVG(score_delta)::numeric, 2) AS avg_score_delta,
            MIN(score_delta) AS min_score_delta,
            MAX(score_delta) AS max_score_delta,
            COUNT(*)::int AS n
     FROM credit_learning_events
     GROUP BY action_type
     ORDER BY avg_score_delta DESC NULLS LAST`
  );
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });


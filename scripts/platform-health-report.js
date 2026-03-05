#!/usr/bin/env node
"use strict";

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST,
  port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
  database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
  user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
});

async function main() {
  const run = await pool.query(
    `SELECT id, repos_scanned
     FROM github_repo_scan_runs
     WHERE status='completed'
     ORDER BY finished_at DESC NULLS LAST, started_at DESC
     LIMIT 1`
  );
  const latestRunId = run.rows[0]?.id || null;
  const reposScanned = run.rows[0]?.repos_scanned || 0;

  let critical = 0;
  let warn = 0;
  let avgHealth = 0;
  if (latestRunId) {
    const v = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE severity='critical')::int AS critical_count,
         COUNT(*) FILTER (WHERE severity='warn')::int     AS warn_count
       FROM github_repo_violations
       WHERE run_id = $1`,
      [latestRunId]
    );
    critical = v.rows[0]?.critical_count || 0;
    warn = v.rows[0]?.warn_count || 0;

    const h = await pool.query(
      `SELECT COALESCE(AVG(stack_health_score),0)::numeric(5,2) AS avg_health
       FROM github_repo_stack_facts
       WHERE run_id = $1`,
      [latestRunId]
    );
    avgHealth = Number(h.rows[0]?.avg_health || 0);
  }

  const s = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE requires_action = true)::int AS active_signals,
       COUNT(*) FILTER (WHERE urgency IN ('critical','high'))::int AS high_urgency
     FROM external_update_signals
     WHERE created_at >= NOW() - interval '30 days'`
  );
  const activeSignals = s.rows[0]?.active_signals || 0;
  const highUrgency = s.rows[0]?.high_urgency || 0;

  const recs = [];
  if (critical > 0) recs.push("Open immediate remediation branch for critical repo violations.");
  if (warn > 0) recs.push("Schedule codemod normalization for top warning clusters.");
  if (highUrgency > 0) recs.push("Create vendor-impact triage board for high urgency external updates.");
  if (recs.length === 0) recs.push("No urgent actions. Continue daily scan cadence.");

  const ins = await pool.query(
    `INSERT INTO platform_health_snapshots
     (source, repos_scanned, critical_violations, warning_violations, avg_stack_health_score, active_vendor_signals, high_urgency_signals, recommendations)
     VALUES ('deterministic', $1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id, snapshot_at`,
    [reposScanned, critical, warn, avgHealth, activeSignals, highUrgency, JSON.stringify(recs)]
  );

  const out = {
    snapshot_id: ins.rows[0].id,
    snapshot_at: ins.rows[0].snapshot_at,
    repos_scanned: reposScanned,
    critical_violations: critical,
    warning_violations: warn,
    avg_stack_health_score: avgHealth,
    active_vendor_signals: activeSignals,
    high_urgency_signals: highUrgency,
    recommendations: recs,
  };

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error("[platform-health-report] fatal:", err.message);
  await pool.end();
  process.exit(1);
});

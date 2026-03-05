#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const LOCK_KEY = 942017; // arbitrary advisory lock id
const DRY_RUN = hasFlag("--dry-run");
const MAX_STEPS = Math.max(1, Number((args.includes("--max-steps") && args[args.indexOf("--max-steps") + 1]) || process.env.BACKLOG_ORCH_MAX_STEPS || "6") || 6);

const STEP_TIMEOUT_MS = Math.max(60_000, Number(process.env.BACKLOG_ORCH_STEP_TIMEOUT_MS || "180000") || 180000);

function runStep(name, cmd, argv = []) {
  const started = Date.now();
  const res = spawnSync(cmd, argv, {
    stdio: "pipe",
    env: process.env,
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
  });
  const out = (res.stdout || "").slice(-2000);
  const err = (res.stderr || "").slice(-2000);
  const timedOut = res.signal === "SIGTERM" || res.signal === "SIGKILL";
  const status = res.status != null ? res.status : (timedOut ? 124 : 1);
  return {
    name,
    ok: status === 0,
    code: status,
    duration_ms: Date.now() - started,
    stdout_tail: out,
    stderr_tail: timedOut ? `${(err || "").trim()}\n[backlog-orchestrator] step timed out after ${STEP_TIMEOUT_MS}ms`.trim() : err,
    timed_out: timedOut,
  };
}

async function shouldRun(stepName, minIntervalMinutes) {
  const { rows } = await pg.query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(started_at)))/60.0 AS age_min
     FROM orchestrator_step_runs
     WHERE step_name = $1
       AND runner = 'backlog_orchestrator'
       AND status IN ('COMPLETED','FAILED')`,
    [stepName]
  );
  const age = Number(rows[0]?.age_min || 1e9);
  return age >= minIntervalMinutes;
}

async function subsystemHealth() {
  const q = await pg.query(
    `SELECT
       EXISTS(
         SELECT 1 FROM device_registry
         WHERE status IN ('ready','busy')
           AND last_heartbeat > NOW() - INTERVAL '90 seconds'
       ) AS workers_ok,
       EXISTS(
         SELECT 1 FROM orchestrator_step_runs
         WHERE step_name='security_sweep' AND status='COMPLETED'
           AND started_at > NOW() - INTERVAL '8 hours'
       ) AS security_recent,
       EXISTS(
         SELECT 1 FROM orchestrator_step_runs
         WHERE step_name='github_scan' AND status='COMPLETED'
           AND started_at > NOW() - INTERVAL '4 hours'
       ) AS github_recent`
  );
  return q.rows[0] || { workers_ok: false, security_recent: false, github_recent: false };
}

async function lastAgeMinutes(stepName) {
  const { rows } = await pg.query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(started_at)))/60.0 AS age_min
     FROM orchestrator_step_runs
     WHERE step_name = $1
       AND runner = 'backlog_orchestrator'
       AND status IN ('COMPLETED','FAILED')`,
    [stepName]
  );
  return Number(rows[0]?.age_min || 1e9);
}

async function main() {
  await pg.connect();
  const lock = await pg.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
  if (!lock.rows[0]?.ok) {
    console.log("[backlog-orchestrator] lock busy; skipping");
    await pg.end().catch(() => {});
    return;
  }

  const results = [];
  try {
    const health = await subsystemHealth();
    const steps = [
      { name: "status_redgreen", cmd: "npm", argv: ["run", "-s", "status:redgreen", "--", "--soft"], minIntervalMinutes: 15, priority: 10, requires: [] },
      { name: "github_scan", cmd: "npm", argv: ["run", "-s", "github:scan", "--", "--limit", "60"], minIntervalMinutes: 15, priority: 9, requires: ["workers_ok"] },
      { name: "repo_normalize_queue", cmd: "npm", argv: ["run", "-s", "repo:normalize:queue", "--", "--limit", "12"], minIntervalMinutes: 10, priority: 8, requires: ["github_recent"] },
      { name: "ai_work_pulse", cmd: "npm", argv: ["run", "-s", "ai:work:pulse"], minIntervalMinutes: 30, priority: 8, requires: ["workers_ok"] },
      { name: "git_sites_pulse", cmd: "npm", argv: ["run", "-s", "git:sites:subagent:pulse"], minIntervalMinutes: 10, priority: 8, requires: ["workers_ok"] },
      { name: "flow_regression_pulse", cmd: "npm", argv: ["run", "-s", "flow:regression:pulse"], minIntervalMinutes: 30, priority: 7, requires: ["workers_ok"] },
      { name: "regression_autofix_pulse", cmd: "npm", argv: ["run", "-s", "flow:regression:autofix:pulse"], minIntervalMinutes: 20, priority: 7, requires: ["workers_ok"] },
      { name: "security_sweep", cmd: "npm", argv: ["run", "-s", "security:sweep"], minIntervalMinutes: 60, priority: 9, requires: ["workers_ok"] },
      { name: "security_remediation_queue", cmd: "npm", argv: ["run", "-s", "security:remediate:queue"], minIntervalMinutes: 60, priority: 8, requires: ["security_recent"] },
      { name: "credit_e2e", cmd: "node", argv: ["scripts/credit-e2e-live-loop.js", "--dry-run"], minIntervalMinutes: 60, priority: 6, requires: ["workers_ok"] },
      { name: "salesops_maintenance", cmd: "npm", argv: ["run", "-s", "salesops:maintenance"], minIntervalMinutes: 60, priority: 6, requires: ["workers_ok"] },
      { name: "sales_production_validate", cmd: "node", argv: ["scripts/sales-production-validate.js", "--strict"], minIntervalMinutes: 120, priority: 6, requires: ["workers_ok"] },
      { name: "finance_subscription_audit", cmd: "npm", argv: ["run", "-s", "finance:subscription:audit", "--", "--days-back", "180"], minIntervalMinutes: 720, priority: 7, requires: ["workers_ok"] },
      { name: "finance_tax_prep", cmd: "npm", argv: ["run", "-s", "finance:tax:prep", "--", "--days-back", "365"], minIntervalMinutes: 1440, priority: 7, requires: ["workers_ok"] },
      { name: "affiliate_research", cmd: "npm", argv: ["run", "-s", "affiliate:research", "--", "--limit", "15"], minIntervalMinutes: 240, priority: 6, requires: [] },
    ];

    const scored = [];
    for (const step of steps) {
      const due = await shouldRun(step.name, step.minIntervalMinutes);
      if (!due) {
        results.push({ name: step.name, skipped: true, reason: "interval_not_elapsed" });
        await pg.query(
          `INSERT INTO orchestrator_step_runs
             (step_name, runner, status, started_at, completed_at, reason, result_json)
           VALUES
             ($1, 'backlog_orchestrator', 'SKIPPED', NOW(), NOW(), $2, $3::jsonb)`,
          [step.name, "interval_not_elapsed", JSON.stringify({ min_interval_minutes: step.minIntervalMinutes })]
        );
        continue;
      }
      const unmet = (step.requires || []).filter((r) => !health[r]);
      if (unmet.length) {
        results.push({ name: step.name, skipped: true, reason: `dependency_unmet:${unmet.join(",")}` });
        await pg.query(
          `INSERT INTO orchestrator_step_runs
             (step_name, runner, status, started_at, completed_at, reason, result_json)
           VALUES
             ($1, 'backlog_orchestrator', 'SKIPPED', NOW(), NOW(), $2, $3::jsonb)`,
          [step.name, `dependency_unmet:${unmet.join(",")}`, JSON.stringify({ unmet })]
        );
        continue;
      }
      const ageMin = await lastAgeMinutes(step.name);
      const overdue = Math.max(0, ageMin - step.minIntervalMinutes);
      const score = (step.priority * 1000) + overdue;
      scored.push({ ...step, ageMin, overdue, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const scheduled = scored.slice(0, MAX_STEPS);

    for (const step of scheduled) {
      if (DRY_RUN) {
        results.push({ name: step.name, skipped: true, reason: "dry_run" });
        await pg.query(
          `INSERT INTO orchestrator_step_runs
             (step_name, runner, status, started_at, completed_at, reason, result_json)
           VALUES
             ($1, 'backlog_orchestrator', 'SKIPPED', NOW(), NOW(), $2, $3::jsonb)`,
          [step.name, "dry_run", JSON.stringify({ selected: true, score: step.score })]
        );
        continue;
      }
      const started = new Date();
      const res = runStep(step.name, step.cmd, step.argv);
      results.push(res);
      await pg.query(
        `INSERT INTO orchestrator_step_runs
           (step_name, runner, status, started_at, completed_at, duration_ms, result_json, reason)
         VALUES
           ($1, 'backlog_orchestrator', $2, $3, NOW(), $4, $5::jsonb, $6)`,
        [
          step.name,
          res.ok ? "COMPLETED" : "FAILED",
          started.toISOString(),
          Number(res.duration_ms || 0),
          JSON.stringify(res),
          res.ok ? null : `exit_code:${res.code}`,
        ]
      );
    }

    const failed = results.filter((r) => r.ok === false).length;
    console.log("\n=== Backlog Orchestrator ===\n");
    console.log(`max_steps: ${MAX_STEPS}`);
    console.log(`steps: ${results.length}`);
    console.log(`failed: ${failed}`);
    for (const r of results) {
      if (r.skipped) {
        console.log(`- ${r.name}: skipped (${r.reason})`);
      } else {
        console.log(`- ${r.name}: ${r.ok ? "ok" : "fail"} (${r.duration_ms}ms)`);
      }
    }

    if (failed > 0) process.exitCode = 1;
  } finally {
    await pg.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    pg.end().catch(() => {});
  }
}

main()
  .then(() => {
    // Ensure this orchestration script does not linger on open handles.
    process.exit(process.exitCode || 0);
  })
  .catch(async (err) => {
    console.error("[backlog-orchestrator] fatal:", err.message);
    try { pg.end().catch(() => {}); } catch {}
    process.exit(1);
  });

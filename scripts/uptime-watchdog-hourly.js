#!/usr/bin/env node
"use strict";

/**
 * scripts/uptime-watchdog-hourly.js
 *
 * Hourly uptime watchdog: finds what should be running but isn't, tries to fix it.
 *
 * Architecture (agent + subagents):
 * - Orchestrator: Runs checker subagents in parallel, then recovery, then diagnosis if needed
 * - Subagent: pm2Checker     — always-on down, cron errored/crash-loop
 * - Subagent: heartbeatChecker — mission-control agents with stale heartbeats
 * - Subagent: queueChecker   — dead letters, tasks:health
 * - Subagent: recoveryExecutor — restart PM2, force-run agents, reconcile deadletters
 * - Subagent: diagnosisAgent — LLM analysis when recovery fails (optional)
 *
 * Schedule: 0 * * * * (every hour on the hour)
 *
 * Usage:
 *   node scripts/uptime-watchdog-hourly.js
 *   node scripts/uptime-watchdog-hourly.js --dry-run   # gather + report only, no fixes
 *   node scripts/uptime-watchdog-hourly.js --no-diagnosis   # skip LLM diagnosis step
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const {
  pm2Checker,
  heartbeatChecker,
  queueChecker,
  recoveryExecutor,
  diagnosisAgent,
} = require("../control/uptime-watchdog-agents");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

const DRY_RUN = process.argv.includes("--dry-run");
const NO_DIAGNOSIS = process.argv.includes("--no-diagnosis");

async function main() {
  const started = new Date().toISOString();
  console.log(`[uptime-watchdog] Starting at ${started} (dryRun=${DRY_RUN})`);

  // ─── Phase 1: Run checker subagents in parallel ───────────────────────────
  const [pm2Result, heartbeatResult, queueResult] = await Promise.all([
    pm2Checker(),
    heartbeatChecker(),
    queueChecker(),
  ]);

  const report = {
    started,
    dry_run: DRY_RUN,
    phase1: {
      pm2: pm2Result,
      heartbeat: heartbeatResult,
      queue: queueResult,
    },
    phase2_recovery: null,
    phase3_diagnosis: null,
    completed_at: null,
    summary: {},
  };

  const allFindings = [
    ...(pm2Result.findings || []),
    ...(heartbeatResult.findings || []),
    ...(queueResult.findings || []),
  ];
  const allActions = [
    ...(pm2Result.actions || []),
    ...(heartbeatResult.actions || []),
    ...(queueResult.actions || []),
  ];

  report.summary.findings_count = allFindings.length;
  report.summary.actions_planned = allActions.length;

  if (allFindings.length > 0) {
    console.log(`[uptime-watchdog] Found ${allFindings.length} issue(s):`);
    for (const f of allFindings.slice(0, 10)) {
      console.log(`  - ${f.message || f.type}`);
    }
  }

  if (allActions.length === 0) {
    console.log("[uptime-watchdog] ✅ All healthy, nothing to do");
    report.completed_at = new Date().toISOString();
    saveReport(report);
    return;
  }

  // ─── Phase 2: Recovery (unless dry-run) ───────────────────────────────────
  if (DRY_RUN) {
    console.log(`[uptime-watchdog] Dry-run: would execute ${allActions.length} action(s)`);
    report.phase2_recovery = { skipped: true, reason: "dry_run" };
  } else {
    console.log(`[uptime-watchdog] Executing ${allActions.length} recovery action(s)...`);
    const recoveryResult = await recoveryExecutor(allActions);
    report.phase2_recovery = recoveryResult;

    if (recoveryResult.restarted?.length > 0) {
      console.log(`[uptime-watchdog] ✅ Restarted: ${recoveryResult.restarted.join(", ")}`);
    }
    if (recoveryResult.forceRun?.length > 0) {
      console.log(`[uptime-watchdog] ✅ Force-run agents: ${recoveryResult.forceRun.join(", ")}`);
    }
    if (recoveryResult.reconciled) {
      console.log("[uptime-watchdog] ✅ Reconciled dead letters");
    }
    if (recoveryResult.errors?.length > 0) {
      console.warn(`[uptime-watchdog] ⚠️ Recovery errors: ${recoveryResult.errors.length}`);
      for (const e of recoveryResult.errors) {
        console.warn(`  - ${e.process || e.agent_id || e.action}: ${e.error}`);
      }
    }
  }

  report.completed_at = new Date().toISOString();

  // ─── Phase 3: Diagnosis when recovery had errors (optional) ───────────────
  const needsDiagnosis =
    !NO_DIAGNOSIS &&
    !DRY_RUN &&
    report.phase2_recovery?.errors?.length > 0 &&
    report.phase2_recovery.errors.length >= 1;

  if (needsDiagnosis) {
    console.log("[uptime-watchdog] Running diagnosis agent (LLM)...");
    try {
      const diagContext = {
        findings: allFindings,
        actions_attempted: allActions,
        recovery_errors: report.phase2_recovery.errors,
        pm2_summary: {
          alwaysOnExpected: pm2Result.alwaysOnExpected,
          findings: pm2Result.findings,
        },
      };
      const diagResult = await diagnosisAgent(diagContext);
      report.phase3_diagnosis = diagResult;
      if (diagResult.suggestions) {
        console.log("[uptime-watchdog] Diagnosis suggestions:");
        console.log(diagResult.suggestions.slice(0, 500) + (diagResult.suggestions.length > 500 ? "..." : ""));
      }
    } catch (err) {
      report.phase3_diagnosis = { ok: false, error: err.message };
      console.warn("[uptime-watchdog] Diagnosis agent failed:", err.message);
    }
  }

  saveReport(report);
  console.log("[uptime-watchdog] Report saved to reports/uptime-watchdog-latest.json");

  const exitCode = report.phase2_recovery?.errors?.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

function saveReport(report) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const latestPath = path.join(REPORTS_DIR, "uptime-watchdog-latest.json");
  const stampedPath = path.join(
    REPORTS_DIR,
    `uptime-watchdog-${Date.now()}.json`
  );
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(latestPath, json, "utf8");
  fs.writeFileSync(stampedPath, json, "utf8");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[uptime-watchdog] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { main };

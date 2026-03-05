#!/usr/bin/env node
/**
 * Daily fix pulse: health → blockers → errors → gaps, then apply safe fixes.
 * Run 3x daily (e.g. 06:00, 14:00, 22:00) to clear dead letters, refresh security_pulse, and optionally get LLM fix suggestions.
 *
 * Usage:
 *   node scripts/daily-fix-pulse.js              # run checks + safe fixes
 *   node scripts/daily-fix-pulse.js --analyze    # also call Gemini/DeepSeek with report for fix suggestions
 *   node scripts/daily-fix-pulse.js --dry        # run checks only, no fixes
 */
"use strict";

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

const REPO = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(REPO, "reports");
const DRY = process.argv.includes("--dry");
const ANALYZE = process.argv.includes("--analyze");

function run(cmd, args = [], opts = {}) {
  const full = cmd.startsWith("npm") ? ["run", "-s", ...cmd.split(" ").slice(1), ...args] : [cmd, ...args];
  const prog = full[0];
  const argv = full.slice(1);
  const out = spawnSync(prog, argv, {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...(DRY && cmd.includes("reconcile") ? {} : {}) },
    timeout: (opts.timeout_sec || 120) * 1000,
  });
  return { ok: out.status === 0, stdout: out.stdout || "", stderr: out.stderr || "", code: out.status };
}

async function main() {
  const started = new Date().toISOString();
  const report = {
    started,
    dry: DRY,
    analyze: ANALYZE,
    health: null,
    gaps: null,
    dead_letters: null,
    security_sweep_run: false,
    security_sweep_recorded: false,
    dead_letter_requeued: false,
    llm_suggestions: null,
    errors: [],
  };

  console.log("[daily-fix] 1. tasks:health");
  const healthOut = run("npm", ["run", "-s", "tasks:health"], { timeout_sec: 150 });
  report.health = { ok: healthOut.ok, exitCode: healthOut.code };
  if (!healthOut.ok) report.errors.push("tasks:health failed");

  console.log("[daily-fix] 2. audit:gaps");
  const gapsOut = run("npm", ["run", "-s", "audit:gaps"], { timeout_sec: 30 });
  report.gaps = { ok: gapsOut.ok, exitCode: gapsOut.code, summary: gapsOut.stdout.slice(-800) };

  console.log("[daily-fix] 3. dead letters");
  const dlOut = run("node", ["cli/dead-letters.js"], { timeout_sec: 10 });
  report.dead_letters = { ok: dlOut.ok, stdout: dlOut.stdout.slice(0, 2000) };

  // Check if security_sweep is stale (gap analysis needs it within 4h)
  let securityRecent = false;
  try {
    const r = await pg.query(
      `SELECT EXISTS(
        SELECT 1 FROM orchestrator_step_runs
        WHERE step_name = 'security_sweep' AND status = 'COMPLETED'
          AND started_at > NOW() - INTERVAL '4 hours'
      ) AS ok`
    );
    securityRecent = r.rows[0]?.ok === true;
  } catch (e) {
    report.errors.push(`security_recent check: ${e.message}`);
  }

  if (!DRY && !securityRecent) {
    console.log("[daily-fix] 4. security:sweep + record");
    const sweepOut = run("npm", ["run", "-s", "security:sweep"], { timeout_sec: 180 });
    report.security_sweep_run = true;
    if (sweepOut.ok) {
      const recordOut = run("node", ["scripts/record-orchestrator-step.js", "security_sweep", "COMPLETED"], { timeout_sec: 5 });
      report.security_sweep_recorded = recordOut.ok;
    }
  } else if (DRY) {
    console.log("[daily-fix] 4. (dry) skip security:sweep");
  } else {
    console.log("[daily-fix] 4. security_sweep recent, skip");
  }

  if (!DRY) {
    console.log("[daily-fix] 5. tasks:reconcile-deadletters --requeue");
    const reconOut = run("npm", ["run", "-s", "tasks:reconcile-deadletters", "--", "--requeue"], { timeout_sec: 30 });
    report.dead_letter_requeued = reconOut.ok;
    if (reconOut.stdout) report.reconcile_stdout = reconOut.stdout.slice(0, 500);
  } else {
    console.log("[daily-fix] 5. (dry) skip reconcile-deadletters");
  }

  if (ANALYZE && (report.errors.length > 0 || report.gaps?.summary?.includes("FAIL") || (report.dead_letters?.stdout || "").includes("Dead Letter"))) {
    console.log("[daily-fix] 6. LLM analysis (triage)");
    const summary = [
      "Health ok: " + report.health?.ok,
      "Gaps ok: " + report.gaps?.ok,
      "Gap summary: " + (report.gaps?.summary || "").slice(0, 1500),
      "Dead letters: " + (report.dead_letters?.stdout || "").slice(0, 1000),
      "Errors: " + JSON.stringify(report.errors),
    ].join("\n");

    try {
      const { chatJson } = require("../infra/model-router");
      const system = `You are a diagnostic agent for an automated task orchestration system. Given a daily fix report, list concrete fix steps: npm commands or script names to run. Be brief. If everything is green, say "No fixes needed."`;
      const result = await chatJson("triage", system, summary, { max_tokens: 800 });
      report.llm_suggestions = result?.text || result?.json?.diagnosis || null;
      if (report.llm_suggestions) console.log("[daily-fix] LLM: " + report.llm_suggestions.slice(0, 300));
    } catch (err) {
      // BUDGET_BLOCKED is expected when daily LLM caps exhausted; don't treat as fatal
      if (/BUDGET_BLOCKED|no eligible provider/i.test(err?.message || "")) {
        report.llm_suggestions = "Budget exhausted; will retry after reset. Core fixes (reconcile, security) still applied.";
        report.llm_skipped_reason = "budget_blocked";
        console.log("[daily-fix] LLM analyze skipped: budget exhausted");
      } else {
        report.errors.push("LLM analyze: " + err.message);
        report.llm_suggestions = null;
      }
    }
  }

  report.completed_at = new Date().toISOString();

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const latestPath = path.join(REPORTS_DIR, "daily-fix-latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), "utf8");
  const stampedPath = path.join(REPORTS_DIR, `daily-fix-${started.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(stampedPath, JSON.stringify(report, null, 2), "utf8");
  console.log("[daily-fix] report written: " + latestPath);

  await pg.end().catch(() => {});
  process.exit(report.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[daily-fix] Fatal:", err.message);
  process.exit(1);
});

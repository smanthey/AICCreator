#!/usr/bin/env node
"use strict";

/**
 * SRE Daily Maintenance — "Deep Maintenance + Roadmap Progress"
 *
 * Runs every 12 hours (or once daily at 3am) to keep momentum: health audit,
 * reliability fixes, backlog acceleration, security pass, documentation updates.
 *
 * Usage:
 *   node scripts/sre-daily-maintenance.js
 *   node scripts/sre-daily-maintenance.js --dry-run
 *
 * Schedule: cron 0 3,15 * * * (3am and 3pm) or 0 3 * * * (daily 3am)
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const INFRA_CHANGES_PATH = process.env.SRE_INFRA_CHANGES_PATH || path.join(os.homedir(), "logs", "infra-changes.md");

const DRY_RUN = process.argv.includes("--dry-run");

const SRE_DAILY_SYSTEM = `You are the OpenClaw Principal Engineer + Release Manager.
Goal: make the system more reliable AND finish high-leverage backlog items without breaking production.

Run this checklist:
1. Health audit: DB connectivity, Redis config correctness, queue lag, DLQ size, worker heartbeats, cron/Trigger jobs.
2. Reliability fixes: reduce restarts, fix recurrent errors, add missing timeouts/backoffs, add safe shutdown handlers.
3. Backlog acceleration: pick up to 3 "quick wins" (<2 hours each) that measurably improve revenue readiness (leadgen/email pipeline robustness, payment flow stability, reporting, compliance gates).
4. Security pass: scan for leaked secrets, unsafe file ops, exfil endpoints, missing validation, overly-permissive policies.
5. Documentation: update runbook + .env.example + setup notes for multi-machine roles (main brain vs workers).

Constraints:
- No new "big rewrites." Only incremental merges.
- Any risky change must be behind a feature flag or default to dry-run.
- Do not run migrations unless they're backward compatible and safe.

Deliverables:
- A structured report (Health / Fixes / Shipped / Risks / Next)
- A PR-ready set of changes (or a single commit)
- A shortlist of the next 5 tasks ranked by ROI`;

function sh(cmd, timeoutMs = 20_000) {
  const r = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
  });
  return String(r.stdout || "") + String(r.stderr || "");
}

function cap(str, n = 4000) {
  const s = String(str || "");
  return s.length <= n ? s : `${s.slice(0, n)}\n...[truncated]`;
}

function gatherContext() {
  const ctx = {};

  try {
    const pm2Out = spawnSync("pm2", ["jlist"], { cwd: ROOT, encoding: "utf8", timeout: 8000 });
    const raw = String(pm2Out.stdout || pm2Out.stderr || "").trim();
    const apps = raw ? (JSON.parse(raw) || []) : [];
    ctx.pm2List = Array.isArray(apps)
      ? JSON.stringify(apps.map((a) => ({ name: a.name, status: a.pm2_env?.status, restarts: a.pm2_env?.restart_time, cron: a.pm2_env?.cron_restart })), null, 2)
      : raw.slice(0, 2000);
  } catch (e) {
    ctx.pm2List = `pm2 jlist failed: ${e.message}`;
  }

  try {
    const healthOut = spawnSync("npm", ["run", "-s", "tasks:health"], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
    ctx.tasksHealth = cap(String(healthOut.stdout || "") + String(healthOut.stderr || ""), 3000);
  } catch (e) {
    ctx.tasksHealth = `tasks:health failed: ${e.message}`;
  }

  try {
    const dlOut = spawnSync("node", ["cli/dead-letters.js"], { cwd: ROOT, encoding: "utf8", timeout: 10_000 });
    ctx.deadLetters = cap(String(dlOut.stdout || "") + String(dlOut.stderr || ""), 2000);
  } catch (e) {
    ctx.deadLetters = `dead-letters failed: ${e.message}`;
  }

  ctx.auditGaps = cap(sh("npm run -s audit:gaps 2>&1 | tail -80", 30_000), 3000);
  ctx.recentErrors = cap(sh("pm2 logs --lines 150 --nostream 2>&1 | grep -iE 'error|fatal|crash' | tail -25"), 2000);
  ctx.gitStatus = cap(sh("git status --short 2>/dev/null | head -30"), 1500);
  ctx.envExample = cap(sh("head -80 .env.example 2>/dev/null || echo 'no .env.example'"), 2000);

  ctx.timestamp = new Date().toISOString();
  return ctx;
}

function buildUserMessage(ctx) {
  return `
Timestamp: ${ctx.timestamp}

--- PM2 process status (with cron) ---
${ctx.pm2List}

--- tasks:health ---
${ctx.tasksHealth}

--- Dead letters ---
${ctx.deadLetters}

--- audit:gaps (last 80 lines) ---
${ctx.auditGaps}

--- Recent errors ---
${ctx.recentErrors}

--- git status (short) ---
${ctx.gitStatus}

--- .env.example (first 80 lines) ---
${ctx.envExample}

---

Run your checklist and produce the structured report (Health / Fixes / Shipped / Risks / Next).
`.trim();
}

async function main() {
  const started = new Date().toISOString();
  console.log("[sre-daily] Gathering context...");
  const ctx = gatherContext();
  const userMsg = buildUserMessage(ctx);

  const report = {
    started,
    dry_run: DRY_RUN,
    context_gathered: true,
    llm_called: false,
    llm_output: null,
    errors: [],
  };

  if (DRY_RUN) {
    report.llm_output = "(dry-run: LLM not called)";
    report.context_preview = userMsg.slice(0, 2000);
  } else {
    try {
      const { chat } = require("../infra/model-router");
      console.log("[sre-daily] Calling LLM (orchestrate/plan)...");
      const result = await chat("orchestrate", SRE_DAILY_SYSTEM, userMsg, { max_tokens: 3000 });
      report.llm_called = true;
      report.llm_output = result?.text || result?.output || String(result);
      if (report.llm_output) {
        console.log("[sre-daily] LLM response length:", report.llm_output.length);
        try {
          const dir = path.dirname(INFRA_CHANGES_PATH);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const entry = `\n## ${started} — SRE Daily Maintenance\n\n${report.llm_output}\n`;
          fs.appendFileSync(INFRA_CHANGES_PATH, entry, "utf8");
          report.infra_changes_appended = true;
        } catch (e) {
          report.infra_changes_error = e.message;
        }
      }
    } catch (err) {
      report.errors.push(err.message);
      report.llm_output = `LLM error: ${err.message}`;
    }
  }

  report.completed_at = new Date().toISOString();
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, "sre-daily-maintenance-latest.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("[sre-daily] Report written to reports/sre-daily-maintenance-latest.json");

  process.exit(report.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[sre-daily] Fatal:", err.message);
  process.exit(1);
});

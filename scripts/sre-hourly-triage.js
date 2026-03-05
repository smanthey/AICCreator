#!/usr/bin/env node
"use strict";

/**
 * SRE Hourly Triage — "Triage + Fix + Unblock"
 *
 * Runs every 60 minutes when the system is unstable or actively building.
 * Gathers PM2 logs, worker status, DLQ, task health; sends to LLM for blocker
 * identification and fix recommendations. Writes report and optional infra-changes log.
 *
 * Usage:
 *   node scripts/sre-hourly-triage.js
 *   node scripts/sre-hourly-triage.js --dry-run   # gather context only, no LLM
 *
 * Schedule: cron 0 * * * * (every hour) or via PM2 cron_restart
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

const SRE_HOURLY_SYSTEM = `You are the OpenClaw SRE + Senior Staff Engineer on-call.
Goal: keep claw-architect healthy and continuously shipping.

Do this loop in order (stop early only if a step fails and needs attention):
1. Read newest logs/errors (PM2 logs, worker/gateway logs, DLQ summaries).
2. Identify the top 1–3 current blockers (crashes, queue stuck, Redis/PG connectivity, webhook failures, failed tasks).
3. For each blocker: propose the smallest safe fix, then implement it (code change + config + migration if needed).
4. Add/adjust guardrails so the same class of failure is prevented (policy gate, retries, backoff, idempotency, caps).
5. Run the minimal verification: unit tests (if available), a smoke run, and confirm queues drain.
6. Write a short changelog entry to ~/logs/infra-changes.md (what changed + why + rollback note).

Constraints:
- Do not touch Telnyx/Stripe production credentials or production sending logic unless explicitly told.
- Prefer reversible changes (feature flags, env toggles, dry-run).
- Never delete user data.
- If you need secrets, ask for them but do not print them.

Output:
- "What I found" (bullet list)
- "What I changed" (exact files + diffs summary)
- "What I verified" (commands + results)
- "Next recommended actions" (max 5)`;

function sh(cmd, timeoutMs = 15_000) {
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
      ? JSON.stringify(apps.map((a) => ({ name: a.name, status: a.pm2_env?.status, restarts: a.pm2_env?.restart_time })), null, 2)
      : raw.slice(0, 2000);
  } catch (e) {
    ctx.pm2List = `pm2 jlist failed: ${e.message}`;
  }

  ctx.recentErrors = cap(sh("pm2 logs --lines 100 --nostream 2>&1 | grep -iE 'error|fatal|crash|fail|exception' | tail -30"), 3000);
  ctx.gatewayLogs = cap(sh("pm2 logs claw-gateway --lines 80 --nostream 2>&1 | tail -80", 10_000), 2500);
  ctx.workerLogs = cap(sh("pm2 logs claw-worker --lines 80 --nostream 2>&1 | tail -80", 10_000), 2500);
  if (!ctx.workerLogs || ctx.workerLogs.length < 50) {
    ctx.workerAiLogs = cap(sh("pm2 logs claw-worker-ai --lines 80 --nostream 2>&1 | tail -80", 10_000), 2500);
  }

  try {
    const dlOut = spawnSync("node", ["cli/dead-letters.js"], { cwd: ROOT, encoding: "utf8", timeout: 10_000 });
    ctx.deadLetters = cap(String(dlOut.stdout || "") + String(dlOut.stderr || ""), 2000);
  } catch (e) {
    ctx.deadLetters = `dead-letters failed: ${e.message}`;
  }

  try {
    const healthOut = spawnSync("npm", ["run", "-s", "tasks:health"], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
    ctx.tasksHealth = cap(String(healthOut.stdout || "") + String(healthOut.stderr || ""), 2000);
  } catch (e) {
    ctx.tasksHealth = `tasks:health failed: ${e.message}`;
  }

  ctx.timestamp = new Date().toISOString();
  return ctx;
}

function buildUserMessage(ctx) {
  return `
Timestamp: ${ctx.timestamp}

--- PM2 process status ---
${ctx.pm2List}

--- Recent errors (grep) ---
${ctx.recentErrors}

--- Gateway logs (last 80) ---
${ctx.gatewayLogs}

--- Worker logs (last 80) ---
${ctx.workerLogs || ctx.workerAiLogs || "(none)"}

--- Dead letters ---
${ctx.deadLetters}

--- tasks:health output ---
${ctx.tasksHealth}

---

Analyze the above and produce your structured output (What I found / What I changed / What I verified / Next recommended actions).
`.trim();
}

async function main() {
  const started = new Date().toISOString();
  console.log("[sre-hourly] Gathering context...");
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
    report.context_preview = userMsg.slice(0, 1500);
  } else {
    try {
      const { chat } = require("../infra/model-router");
      console.log("[sre-hourly] Calling LLM (triage)...");
      const result = await chat("triage", SRE_HOURLY_SYSTEM, userMsg, { max_tokens: 2000 });
      report.llm_called = true;
      report.llm_output = result?.text || result?.output || String(result);
      if (report.llm_output) {
        console.log("[sre-hourly] LLM response length:", report.llm_output.length);
        // Append to infra-changes.md
        try {
          const dir = path.dirname(INFRA_CHANGES_PATH);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const entry = `\n## ${started} — SRE Hourly Triage\n\n${report.llm_output}\n`;
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
  fs.writeFileSync(path.join(REPORTS_DIR, "sre-hourly-triage-latest.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("[sre-hourly] Report written to reports/sre-hourly-triage-latest.json");

  process.exit(report.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[sre-hourly] Fatal:", err.message);
  process.exit(1);
});

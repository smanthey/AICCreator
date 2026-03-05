"use strict";

/**
 * control/uptime-watchdog-agents.js
 *
 * Subagents for the hourly uptime watchdog. Each subagent is a focused async
 * function that gathers findings or applies fixes. The main orchestrator runs
 * them in parallel where safe and sequences recovery after diagnosis.
 *
 * Subagents:
 * - pm2Checker: What PM2 processes should be running vs actual state
 * - heartbeatChecker: Mission-control agents with stale heartbeats
 * - queueChecker: Task health, dead letters, routing orphans
 * - recoveryExecutor: Restart PM2, force-run agents, reconcile deadletters
 * - diagnosisAgent: LLM analysis when recovery fails (optional)
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const http = require("http");

const execAsync = promisify(exec);
const REPO = path.join(__dirname, "..");
const HEALTH_CHECK_TIMEOUT_MS = Number(process.env.UPTIME_WATCHDOG_HEALTH_TIMEOUT_MS || "2500");

const CRITICAL_HEALTH_ENDPOINTS = {
  "claw-brand-control-plane": "http://127.0.0.1:4050/healthz",
  "claw-prompt-oracle": "http://127.0.0.1:3031/healthz",
  "claw-bot-commerce-api": "http://127.0.0.1:3032/healthz",
  "claw-webhook-server": "http://127.0.0.1:4040/healthz",
};

function probeHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const statusCode = Number(res.statusCode || 0);
      res.resume();
      resolve({
        ok: statusCode === 200,
        statusCode,
      });
    });

    req.setTimeout(HEALTH_CHECK_TIMEOUT_MS, () => {
      req.destroy(new Error(`timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`));
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        statusCode: 0,
        error: err.message,
      });
    });
  });
}

// Load ecosystem to classify always-on vs cron
function loadEcosystemApps() {
  try {
    const config = require("../ecosystem.background.config.js");
    const apps = config.apps || [];
    return apps.map((a) => ({
      name: a.name,
      autorestart: a.autorestart !== false,
      cron_restart: a.cron_restart || null,
      script: a.script,
      isAlwaysOn: !a.cron_restart && a.autorestart !== false,
      isCron: !!a.cron_restart,
    }));
  } catch {
    return [];
  }
}

// ─── Subagent: PM2 Checker ─────────────────────────────────────────────────

async function pm2Checker() {
  const apps = loadEcosystemApps();
  const alwaysOn = apps.filter((a) => a.isAlwaysOn).map((a) => a.name);
  const cronApps = apps.filter((a) => a.isCron).map((a) => a.name);

  let processes = [];
  try {
    const { stdout } = await execAsync("pm2 jlist", {
      cwd: REPO,
      encoding: "utf8",
    });
    processes = JSON.parse(stdout || "[]");
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      findings: [{ type: "pm2_unavailable", message: `pm2 jlist failed: ${err.message}` }],
      alwaysOnExpected: alwaysOn,
      actions: [],
    };
  }

  const byName = new Map(processes.map((p) => [p.name, p]));
  const findings = [];
  const actions = [];

  // Always-on: must be online
  for (const name of alwaysOn) {
    const proc = byName.get(name);
    const status = proc?.pm2_env?.status || "missing";
    const restarts = proc?.pm2_env?.restart_time || 0;

    if (status !== "online") {
      findings.push({
        type: "always_on_down",
        process: name,
        status,
        restarts,
        message: `${name} should be online but is ${status}`,
      });
      actions.push({ action: "restart", process: name, reason: `always-on ${status}` });
    } else if (restarts > 20) {
      findings.push({
        type: "crash_loop",
        process: name,
        restarts,
        message: `${name} has ${restarts} restarts (possible crash loop)`,
      });
      actions.push({ action: "restart", process: name, reason: "high restart count" });
    }
  }

  // Critical endpoints: process online is necessary but not sufficient.
  // Verify /healthz responds 200 before marking service healthy.
  for (const [name, url] of Object.entries(CRITICAL_HEALTH_ENDPOINTS)) {
    const proc = byName.get(name);
    const status = proc?.pm2_env?.status || "missing";
    if (status !== "online") continue;

    const probe = await probeHealth(url);
    if (!probe.ok) {
      findings.push({
        type: "endpoint_unhealthy",
        process: name,
        url,
        statusCode: probe.statusCode,
        error: probe.error || null,
        message: `${name} health check failed at ${url} (${probe.statusCode || "no response"})`,
      });
      actions.push({
        action: "restart",
        process: name,
        reason: `endpoint unhealthy (${url})`,
      });
    }
  }

  // Cron: stopped is OK; missing/errored/crash-loop needs action
  for (const name of cronApps) {
    const proc = byName.get(name);
    const status = proc?.pm2_env?.status || "missing";
    const restarts = proc?.pm2_env?.restart_time || 0;

    if (status === "missing") {
      findings.push({
        type: "cron_missing",
        process: name,
        message: `${name} (cron) not in PM2 — needs to be started to register`,
      });
      actions.push({ action: "start", process: name, reason: "cron missing from PM2" });
    } else if (status === "errored") {
      // Errored at any restart count = needs a restart.
      // Both the low-restart case (< 10) and the high-restart case (>= 10) are handled here
      // so the cron_crash_loop branch below can focus solely on truly rapid crash loops.
      findings.push({
        type: "cron_errored",
        process: name,
        restarts,
        message: `${name} (cron) is errored`,
      });
      actions.push({ action: "restart", process: name, reason: "cron errored" });
    } else if (status === "online" && restarts > 50) {
      // A cron that is currently executing (online) with >50 restarts is restarting
      // far faster than its cron interval allows — genuine rapid crash loop.
      // Normal cron operation: status = "stopped" between runs.
      // Do NOT flag processes that are merely "stopped" with accumulated cron restarts —
      // e.g. */10 cron accumulates 50 restarts in ~8 hours of normal operation.
      findings.push({
        type: "cron_crash_loop",
        process: name,
        restarts,
        message: `${name} (cron) has ${restarts} restarts while online (rapid crash loop)`,
      });
      actions.push({ action: "restart", process: name, reason: "cron crash loop" });
    }
  }

  return {
    ok: findings.length === 0,
    processesTotal: processes.length,
    alwaysOnExpected: alwaysOn,
    cronApps,
    findings,
    actions,
  };
}

// ─── Subagent: Heartbeat Checker ───────────────────────────────────────────

function parseLastLogTs(filePath) {
  try {
    const txt = fs.readFileSync(filePath, "utf8");
    const lines = String(txt).split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = String(lines[i] || "").trim();
      if (!line.startsWith("## ")) continue;
      const ts = Date.parse(line.slice(3).trim());
      if (Number.isFinite(ts)) return ts;
    }
  } catch {}
  return null;
}

function dateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function heartbeatChecker() {
  const configPath = path.join(REPO, "config", "mission-control-agents.json");
  let agents = [];
  try {
    agents = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { ok: true, findings: [], actions: [] };
  }

  const { STATE_ROOT } = require("./agent-memory");
  const now = Date.now();
  const today = dateKey();
  const staleThresholdMin = Math.max(30, Number(process.env.UPTIME_WATCHDOG_STALE_MINUTES || "90"));

  const findings = [];
  const actions = [];

  for (const a of agents) {
    const id = String(a.id || "").toLowerCase();
    const pm2Name = `claw-mission-${id}`;
    const logPath = path.join(STATE_ROOT, "agents", id, "memory", today);
    const ts = parseLastLogTs(logPath);
    const ageMin = ts ? Math.floor((now - ts) / 60000) : null;
    const stale = ageMin == null || ageMin > Math.max(staleThresholdMin, a.heartbeat_minutes * 2);

    if (!stale) continue;

    findings.push({
      type: "stale_heartbeat",
      agent_id: id,
      agent_name: a.name,
      age_minutes: ageMin,
      heartbeat_minutes: a.heartbeat_minutes,
      message: `${a.name} heartbeat stale (${ageMin != null ? ageMin + " min" : "never ran"})`,
    });
    actions.push({
      action: "force_run_agent",
      agent_id: id,
      reason: "stale heartbeat",
    });
  }

  return {
    ok: findings.length === 0,
    agentsChecked: agents.length,
    findings,
    actions,
  };
}

// ─── Subagent: Queue Checker ───────────────────────────────────────────────

async function queueChecker() {
  const actions = [];
  let deadLetterCount = 0;
  let taskHealthOk = true;

  try {
    const { stdout } = await execAsync("node cli/dead-letters.js", {
      cwd: REPO,
      encoding: "utf8",
      timeout: 15_000,
    });
    const txt = String(stdout || "");
    const dlMatch = txt.match(/(\d+)\s+dead/);
    deadLetterCount = dlMatch ? parseInt(dlMatch[1], 10) : 0;
  } catch {
    // Non-fatal
  }

  if (deadLetterCount > 0) {
    actions.push({ action: "reconcile_deadletters", reason: `${deadLetterCount} dead letter(s)` });
  }

  try {
    const { stdout } = await execAsync("npm run -s tasks:health", {
      cwd: REPO,
      encoding: "utf8",
      timeout: 150_000,
    });
    if (/FAIL|ERROR/i.test(stdout)) taskHealthOk = false;
  } catch {
    taskHealthOk = false;
    actions.push({ action: "tasks_health_failed", reason: "tasks:health failed or timed out" });
  }

  return {
    ok: deadLetterCount === 0 && taskHealthOk,
    deadLetterCount,
    taskHealthOk,
    actions,
    findings:
      deadLetterCount > 0 || !taskHealthOk
        ? [{ type: "queue_issues", deadLetterCount, taskHealthOk }]
        : [],
  };
}

// ─── Subagent: Recovery Executor ───────────────────────────────────────────

const FORCE_RUN_CAP_PER_CYCLE = 3;

async function recoveryExecutor(actionsFromCheckers) {
  const results = { restarted: [], forceRun: [], reconciled: false, errors: [] };
  const seen = new Set();
  let forceRunCount = 0;

  for (const a of actionsFromCheckers) {
    if (a.action === "restart" && a.process && !seen.has(`restart:${a.process}`)) {
      seen.add(`restart:${a.process}`);
      try {
        await execAsync(`pm2 restart ${a.process}`, { cwd: REPO, timeout: 15_000 });
        results.restarted.push(a.process);
      } catch (err) {
        results.errors.push({ process: a.process, error: err.message });
      }
    } else if (a.action === "start" && a.process && !seen.has(`start:${a.process}`)) {
      seen.add(`start:${a.process}`);
      try {
        await execAsync(`pm2 start ecosystem.background.config.js --only ${a.process}`, {
          cwd: REPO,
          timeout: 15_000,
        });
        results.restarted.push(a.process);
      } catch (err) {
        results.errors.push({ process: a.process, error: err.message });
      }
    } else if (
      a.action === "force_run_agent" &&
      a.agent_id &&
      !seen.has(`run:${a.agent_id}`) &&
      forceRunCount < FORCE_RUN_CAP_PER_CYCLE
    ) {
      seen.add(`run:${a.agent_id}`);
      forceRunCount++;
      try {
        await execAsync(`npm run mission:control:run -- --agent ${a.agent_id} --skip-coordination`, {
          cwd: REPO,
          timeout: 300_000,
        });
        results.forceRun.push(a.agent_id);
      } catch (err) {
        results.errors.push({ agent_id: a.agent_id, error: err.message });
      }
    } else if (a.action === "reconcile_deadletters" && !seen.has("reconcile")) {
      seen.add("reconcile");
      try {
        await execAsync("npm run -s tasks:reconcile-deadletters", {
          cwd: REPO,
          timeout: 60_000,
        });
        results.reconciled = true;
      } catch (err) {
        results.errors.push({ action: "reconcile_deadletters", error: err.message });
      }
    }
  }

  return results;
}

// ─── Subagent: Diagnosis Agent (LLM) ───────────────────────────────────────

async function diagnosisAgent(context) {
  const { chat } = require("../infra/model-router");

  const systemPrompt = `You are the OpenClaw SRE diagnosis agent. The uptime watchdog tried to recover failing services but some fixes failed or issues persist.

Your job: analyze the context and produce a SHORT action plan (max 5 bullets) for a human to execute. Be specific: exact commands, file paths, env vars to check.
Do NOT make code changes. Only recommend.`;

  try {
    const result = await chat("triage", systemPrompt, JSON.stringify(context, null, 2), {
      max_tokens: 800,
    });
    return {
      ok: true,
      suggestions: result?.text || result?.output || String(result),
    };
  } catch (err) {
    return { ok: false, error: err.message, suggestions: null };
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  pm2Checker,
  heartbeatChecker,
  queueChecker,
  recoveryExecutor,
  diagnosisAgent,
  loadEcosystemApps,
};

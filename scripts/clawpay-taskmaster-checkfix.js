#!/usr/bin/env node
"use strict";

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createToolBudget } = require("../control/mcp-tool-budget");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const TASKMASTER_REPORT = path.join(REPORTS_DIR, "clawpay-task-master-latest.json");

const REQUIRED_SERVICES = [
  "clawpay-task-master",
  "claw-prompt-oracle",
  "claw-bot-commerce-api",
  "claw-discord-gateway",
];

const TASKMASTER_STALE_MINUTES = Math.max(
  10,
  Number(process.env.CLAWPAY_TASKMASTER_STALE_MINUTES || "40")
);

function nowIso() {
  return new Date().toISOString();
}

function cap(text, n = 4000) {
  const s = String(text || "");
  return s.length <= n ? s : `${s.slice(0, n)}\n...[truncated]`;
}

function createRunBudget() {
  return createToolBudget({
    maxCalls: Number(process.env.CLAWPAY_CHECKFIX_TOOL_BUDGET_MAX_CALLS || process.env.MCP_TOOL_BUDGET_MAX_CALLS || 40),
    maxTokensPerTool: Number(process.env.CLAWPAY_CHECKFIX_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || 12000),
    maxTokensTotal: Number(process.env.CLAWPAY_CHECKFIX_TOOL_BUDGET_MAX_TOKENS_TOTAL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_TOTAL || 90000),
  });
}

function run(cmd, args, timeoutMs = 10 * 60 * 1000, budget = null, toolName = "shell_command") {
  const startedAt = nowIso();
  const commandStr = [cmd, ...args].join(" ");
  const guard = budget ? budget.record(toolName, commandStr) : { allowed: true, violations: [] };
  if (!guard.allowed) {
    return {
      command: commandStr,
      started_at: startedAt,
      finished_at: nowIso(),
      ok: false,
      blocked_by_budget: true,
      code: 429,
      stdout_tail: "",
      stderr_tail: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
      error: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
    };
  }
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 12 * 1024 * 1024,
  });
  return {
    command: commandStr,
    started_at: startedAt,
    finished_at: nowIso(),
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout_tail: cap(r.stdout),
    stderr_tail: cap(r.stderr),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function readPm2List(budget = null) {
  const startedAt = nowIso();
  const guard = budget ? budget.record("pm2_list", "pm2 jlist") : { allowed: true, violations: [] };
  if (!guard.allowed) {
    return {
      ok: false,
      result: {
        command: "pm2 jlist",
        started_at: startedAt,
        finished_at: nowIso(),
        ok: false,
        blocked_by_budget: true,
        code: 429,
        stdout_tail: "",
        stderr_tail: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
        error: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
      },
      processes: [],
    };
  }

  const r = spawnSync("pm2", ["jlist"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 24 * 1024 * 1024,
  });
  const result = {
    command: "pm2 jlist",
    started_at: startedAt,
    finished_at: nowIso(),
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout_tail: cap(r.stdout),
    stderr_tail: cap(r.stderr),
    error: r.error ? String(r.error.message || r.error) : null,
  };

  if (!result.ok) {
    return { ok: false, result, processes: [] };
  }
  try {
    const parsed = JSON.parse(String(r.stdout || "[]"));
    return { ok: true, result, processes: Array.isArray(parsed) ? parsed : [] };
  } catch (err) {
    return {
      ok: false,
      result: {
        ...result,
        ok: false,
        error: `pm2_jlist_parse_failed: ${String(err.message || err)}`,
      },
      processes: [],
    };
  }
}

function taskMasterFreshness() {
  try {
    const stat = fs.statSync(TASKMASTER_REPORT);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
    return {
      exists: true,
      mtime: new Date(stat.mtimeMs).toISOString(),
      age_minutes: Number(ageMinutes.toFixed(2)),
      stale: ageMinutes > TASKMASTER_STALE_MINUTES,
    };
  } catch {
    return {
      exists: false,
      mtime: null,
      age_minutes: null,
      stale: true,
    };
  }
}

function ensureServiceOnline(name, processes, budget = null) {
  const matches = processes.filter((p) => (p.name || "") === name);
  const online = matches.some((p) => p.pm2_env && p.pm2_env.status === "online");
  if (online) {
    return { service: name, ok: true, action: "none", reason: "already_online" };
  }
  if (matches.length > 0) {
    const restarted = run("pm2", ["restart", name], 45_000, budget, "pm2_restart");
    return {
      service: name,
      ok: restarted.ok,
      action: "restart",
      reason: "not_online",
      result: restarted,
    };
  }
  const started = run("pm2", ["start", "ecosystem.background.config.js", "--only", name], 60_000, budget, "pm2_start");
  return {
    service: name,
    ok: started.ok,
    action: "start",
    reason: "missing",
    result: started,
  };
}

function writeReport(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const latest = path.join(REPORTS_DIR, "clawpay-taskmaster-checkfix-latest.json");
  const stamped = path.join(REPORTS_DIR, `${stamp}-clawpay-taskmaster-checkfix.json`);
  const payload = JSON.stringify(report, null, 2);
  fs.writeFileSync(latest, payload, "utf8");
  fs.writeFileSync(stamped, payload, "utf8");
  return { latest, stamped };
}

function main() {
  const budget = createRunBudget();
  const report = {
    generated_at: nowIso(),
    required_services: REQUIRED_SERVICES,
    taskmaster_stale_minutes_threshold: TASKMASTER_STALE_MINUTES,
    checks: {},
    actions: {},
    ok: true,
  };

  const pm2 = readPm2List(budget);
  report.checks.pm2_jlist = pm2.result;
  report.checks.taskmaster_freshness = taskMasterFreshness();

  const serviceEnsures = [];
  for (const name of REQUIRED_SERVICES) {
    serviceEnsures.push(ensureServiceOnline(name, pm2.processes, budget));
  }
  report.actions.ensure_required_services = serviceEnsures;

  if (report.checks.taskmaster_freshness.stale) {
    report.actions.restart_stale_taskmaster = run("pm2", ["restart", "clawpay-task-master"], 45_000, budget, "pm2_restart");
  } else {
    report.actions.restart_stale_taskmaster = {
      command: "pm2 restart clawpay-task-master",
      ok: true,
      code: 0,
      skipped: true,
      reason: "fresh",
    };
  }

  report.actions.auto_recovery = run("node", ["scripts/auto-recovery-pulse.js"], 8 * 60 * 1000, budget, "recovery");
  report.actions.uptime_watchdog = run(
    "node",
    ["scripts/uptime-watchdog-hourly.js", "--no-diagnosis"],
    12 * 60 * 1000,
    budget,
    "watchdog"
  );

  const postPm2 = readPm2List(budget);
  report.checks.post_pm2_jlist = postPm2.result;
  report.checks.post_service_status = REQUIRED_SERVICES.map((name) => {
    const matches = postPm2.processes.filter((p) => (p.name || "") === name);
    const online = matches.filter((p) => p.pm2_env && p.pm2_env.status === "online").length;
    return {
      service: name,
      online,
      total: matches.length,
      statuses: [...new Set(matches.map((p) => (p.pm2_env && p.pm2_env.status) || "unknown"))],
    };
  });

  report.actions.reensure_required_services = [];
  for (const name of REQUIRED_SERVICES) {
    report.actions.reensure_required_services.push(ensureServiceOnline(name, postPm2.processes, budget));
  }

  const finalPm2 = readPm2List(budget);
  report.checks.final_pm2_jlist = finalPm2.result;
  report.checks.final_service_status = REQUIRED_SERVICES.map((name) => {
    const matches = finalPm2.processes.filter((p) => (p.name || "") === name);
    const online = matches.filter((p) => p.pm2_env && p.pm2_env.status === "online").length;
    return {
      service: name,
      online,
      total: matches.length,
      statuses: [...new Set(matches.map((p) => (p.pm2_env && p.pm2_env.status) || "unknown"))],
    };
  });

  const postFreshness = taskMasterFreshness();
  report.checks.post_taskmaster_freshness = postFreshness;

  const allRequiredOnline = report.checks.final_service_status.every((s) => s.online > 0);
  report.budget = budget.snapshot();
  report.warnings = [];
  if (postFreshness.stale) {
    report.warnings.push(
      "taskmaster report is stale or missing; task-master restarted and will refresh on cycle completion"
    );
  }
  if (!report.actions.uptime_watchdog.ok) {
    report.warnings.push("uptime watchdog returned non-zero; see report.actions.uptime_watchdog for details");
  }

  report.ok = allRequiredOnline && report.budget.ok;

  const files = writeReport(report);
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        all_required_online: allRequiredOnline,
        taskmaster_report_stale: postFreshness.stale,
        report: files.latest,
      },
      null,
      2
    )
  );

  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createToolBudget } = require("../control/mcp-tool-budget");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const CORE_PM2_APPS = ["claw-architect-api"];

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function parseTrailingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.indexOf("{"); i >= 0; i = raw.indexOf("{", i + 1)) {
    try {
      return JSON.parse(raw.slice(i));
    } catch {
      // continue scanning
    }
  }
  return null;
}

function createRunBudget() {
  return createToolBudget({
    maxCalls: Number(process.env.MCP_OPS_TOOL_BUDGET_MAX_CALLS || process.env.MCP_TOOL_BUDGET_MAX_CALLS || 40),
    maxTokensPerTool: Number(process.env.MCP_OPS_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || 12000),
    maxTokensTotal: Number(process.env.MCP_OPS_TOOL_BUDGET_MAX_TOKENS_TOTAL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_TOTAL || 90000),
  });
}

function runStep(name, command, timeoutMs = 180000, budget = null) {
  const startedAt = new Date().toISOString();
  const guard = budget ? budget.record("shell_step", command) : { allowed: true, violations: [] };
  if (!guard.allowed) {
    return {
      name,
      command,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      blocked_by_budget: true,
      code: 429,
      parsed: null,
      stdout_tail: "",
      stderr_tail: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
    };
  }
  const res = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  const merged = `${stdout}\n${stderr}`;
  return {
    name,
    command,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    parsed: parseTrailingJson(merged),
    stdout_tail: stdout.slice(-1400),
    stderr_tail: stderr.slice(-1400),
  };
}

function listFailedChecks(healthParsed) {
  const checks = Array.isArray(healthParsed?.checks) ? healthParsed.checks : [];
  return checks.filter((c) => !c.ok).map((c) => String(c.label || "unknown"));
}

function pm2Snapshot(budget = null) {
  const guard = budget ? budget.record("pm2_snapshot", "pm2 jlist") : { allowed: true, violations: [] };
  if (!guard.allowed) {
    return { ok: false, blocked_by_budget: true, error: `tool_budget_exceeded: ${guard.violations.join(", ")}`, apps: {} };
  }
  const res = spawnSync("bash", ["-lc", "pm2 jlist"], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: 30000,
  });
  if (Number(res.status || 0) !== 0) {
    return { ok: false, error: String(res.stderr || "pm2 jlist failed").trim(), apps: {} };
  }
  let arr = [];
  try {
    arr = JSON.parse(String(res.stdout || "[]"));
  } catch {
    return { ok: false, error: "pm2 jlist parse failed", apps: {} };
  }
  const apps = {};
  for (const app of arr) {
    const name = String(app?.name || "").trim();
    if (!name) continue;
    apps[name] = {
      status: String(app?.pm2_env?.status || "unknown"),
      restarts: Number(app?.pm2_env?.restart_time || 0),
      pid: Number(app?.pid || 0),
    };
  }
  return { ok: true, apps };
}

function evaluateCorePm2Health(snapshot) {
  const missingOrDown = [];
  for (const name of CORE_PM2_APPS) {
    const status = snapshot?.apps?.[name]?.status || "missing";
    if (status !== "online") missingOrDown.push({ name, status });
  }
  return {
    ok: missingOrDown.length === 0,
    missing_or_down: missingOrDown,
  };
}

function selfHeal(failedChecks, pm2Core, dryRun, budget = null) {
  const actions = [];

  // Ensure MCP wrapper scripts stay executable.
  const chmodCmd = [
    "chmod +x scripts/mcp-postgres.sh",
    "chmod +x scripts/mcp-filesystem.sh",
    "chmod +x scripts/mcp-github.sh",
    "chmod +x scripts/mcp-context7.sh",
  ].join(" && ");
  actions.push(dryRun ? { name: "chmod_wrappers", dry_run: true, command: chmodCmd, ok: true } : runStep("chmod_wrappers", chmodCmd, 30000, budget));

  // Always sync config so Cursor/VSCode/OpenClaw share one MCP manifest.
  actions.push(dryRun ? { name: "mcp_sync", dry_run: true, command: "npm run -s mcp:sync", ok: true } : runStep("mcp_sync", "npm run -s mcp:sync", 120000, budget));

  const needsRestart =
    !pm2Core.ok;
  if (needsRestart) {
    const cmd = "pm2 restart claw-architect-api";
    actions.push(dryRun ? { name: "restart_mcp_api", dry_run: true, command: cmd, ok: true } : runStep("restart_mcp_api", cmd, 60000, budget));
  }

  if (!pm2Core.ok) {
    const cmd = "pm2 start ecosystem.background.config.js --only claw-architect-api";
    actions.push(
      dryRun
        ? { name: "start_core_pm2_apps", dry_run: true, command: cmd, ok: true }
        : runStep("start_core_pm2_apps", cmd, 90000, budget)
    );
  }

  return actions;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportPath = path.join(REPORT_DIR, `${stamp}-mcp-ops-agent.json`);
  const latestPath = path.join(REPORT_DIR, "mcp-ops-agent-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { reportPath, latestPath };
}

function main() {
  const dryRun = has("--dry-run");
  const budget = createRunBudget();

  const steps = [];
  const system = {
    node_version: process.version,
    platform: process.platform,
    hostname: require("os").hostname(),
  };

  const topoPre = dryRun
    ? { name: "topology_precheck", dry_run: true, command: "npm run -s verify:topology", ok: true, parsed: { ok: true } }
    : runStep("topology_precheck", "npm run -s verify:topology", 180000, budget);
  steps.push(topoPre);

  // Baseline sync before checks.
  steps.push(dryRun ? { name: "mcp_sync_initial", dry_run: true, command: "npm run -s mcp:sync", ok: true } : runStep("mcp_sync_initial", "npm run -s mcp:sync", 120000, budget));

  const healthInitial = dryRun
    ? { name: "mcp_health_initial", dry_run: true, command: "npm run -s mcp:health", ok: true, parsed: { ok: true, checks: [] } }
    : runStep("mcp_health_initial", "npm run -s mcp:health", 180000, budget);
  steps.push(healthInitial);

  const pm2Pre = pm2Snapshot(budget);
  const corePm2Pre = evaluateCorePm2Health(pm2Pre);

  const failedChecks = listFailedChecks(healthInitial.parsed);
  const healActions = selfHeal(failedChecks, corePm2Pre, dryRun, budget);
  for (const action of healActions) steps.push(action);

  const healthFinal = dryRun
    ? { name: "mcp_health_final", dry_run: true, command: "npm run -s mcp:health", ok: true, parsed: { ok: true, checks: [] } }
    : runStep("mcp_health_final", "npm run -s mcp:health", 180000, budget);
  steps.push(healthFinal);

  const preflight = dryRun
    ? { name: "priority_symbol_preflight", dry_run: true, command: "npm run -s index:preflight:priority", ok: true, parsed: { ok: true } }
    : runStep("priority_symbol_preflight", "npm run -s index:preflight:priority", 300000, budget);
  steps.push(preflight);

  const topoPost = dryRun
    ? { name: "topology_postcheck", dry_run: true, command: "npm run -s verify:topology", ok: true, parsed: { ok: true } }
    : runStep("topology_postcheck", "npm run -s verify:topology", 180000, budget);
  steps.push(topoPost);

  const pm2Post = pm2Snapshot(budget);
  const corePm2Post = evaluateCorePm2Health(pm2Post);

  const report = {
    ok: Boolean(healthFinal.parsed?.ok) && Boolean(preflight.parsed?.ok) && corePm2Post.ok && budget.snapshot().ok,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    system,
    failed_checks_initial: failedChecks,
    healed: healActions.filter((x) => x.ok).map((x) => x.name),
    steps,
    pm2: {
      pre: corePm2Pre,
      post: corePm2Post,
    },
    budget: budget.snapshot(),
    summary: {
      mcp_health_ok: Boolean(healthFinal.parsed?.ok),
      priority_index_preflight_ok: Boolean(preflight.parsed?.ok),
      topology_ok: Boolean(topoPost.parsed?.ok ?? topoPost.ok),
      core_pm2_ok: corePm2Post.ok,
      checks_total: Array.isArray(healthFinal.parsed?.checks) ? healthFinal.parsed.checks.length : 0,
      checks_failed: listFailedChecks(healthFinal.parsed),
      budget_ok: budget.snapshot().ok,
    },
  };

  const paths = writeReport(report);
  console.log(JSON.stringify({ ...report, report: paths }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();

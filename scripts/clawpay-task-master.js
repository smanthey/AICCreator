#!/usr/bin/env node
"use strict";

require("dotenv").config({ override: true });

const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { createToolBudget } = require("../control/mcp-tool-budget");

const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const STATE_DIR = path.join(ROOT, "agent-state", "clawpay-task-master");
const STATE_PATH = path.join(STATE_DIR, "state.json");

const LOOP_SECONDS = Math.max(60, Number(process.env.CLAWPAY_TASKMASTER_LOOP_SECONDS || "600"));
const DISCOVERY_MINUTES = Math.max(5, Number(process.env.CLAWPAY_DISCOVERY_EVERY_MINUTES || "120"));
const OUTREACH_MINUTES = Math.max(5, Number(process.env.CLAWPAY_OUTREACH_EVERY_MINUTES || "60"));
const RESEARCH_MINUTES = Math.max(15, Number(process.env.CLAWPAY_RESEARCH_EVERY_MINUTES || "1440"));
const KAIZEN_MINUTES = Math.max(15, Number(process.env.CLAWPAY_KAIZEN_EVERY_MINUTES || "60"));

const ALWAYS_ON_SERVICES = [
  "claw-prompt-oracle",
  "claw-bot-commerce-api",
  "claw-discord-gateway",
];

const BOOTSTRAP_SERVICES = [
  "claw-bot-discovery",
  "claw-bot-outreach",
  "claw-bot-sales-research-daily",
];

function nowIso() {
  return new Date().toISOString();
}

function minutesSince(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(iso).getTime();
  return ms / 60000;
}

function cap(text, n = 2000) {
  const value = String(text || "");
  if (value.length <= n) return value;
  return `${value.slice(0, n)}\n...[truncated]`;
}

async function ensureDirs() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.mkdir(STATE_DIR, { recursive: true });
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      cycles: Number(parsed.cycles || 0),
      last_discovery_at: parsed.last_discovery_at || null,
      last_outreach_at: parsed.last_outreach_at || null,
      last_research_at: parsed.last_research_at || null,
      last_kaizen_at: parsed.last_kaizen_at || null,
      last_bootstrap_at: parsed.last_bootstrap_at || null,
    };
  } catch {
    return {
      cycles: 0,
      last_discovery_at: null,
      last_outreach_at: null,
      last_research_at: null,
      last_kaizen_at: null,
      last_bootstrap_at: null,
    };
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function createRunBudget() {
  return createToolBudget({
    maxCalls: Number(process.env.CLAWPAY_TOOL_BUDGET_MAX_CALLS || process.env.MCP_TOOL_BUDGET_MAX_CALLS || 60),
    maxTokensPerTool: Number(process.env.CLAWPAY_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || 12000),
    maxTokensTotal: Number(process.env.CLAWPAY_TOOL_BUDGET_MAX_TOKENS_TOTAL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_TOTAL || 120000),
  });
}

async function runCmd(cmd, args, timeoutMs = 10 * 60 * 1000, budget = null, toolName = "shell_command") {
  const startedAt = nowIso();
  const commandStr = `${cmd} ${args.join(" ")}`;
  const guard = budget ? budget.record(toolName, commandStr) : { allowed: true, violations: [] };
  if (!guard.allowed) {
    return {
      command: commandStr,
      ok: false,
      blocked_by_budget: true,
      code: 429,
      started_at: startedAt,
      finished_at: nowIso(),
      stdout_tail: "",
      stderr_tail: "",
      stdout: "",
      stderr: "",
      error: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
    };
  }

  console.log(`[clawpay-task-master] run: ${commandStr}`);
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: ROOT,
      timeout: timeoutMs,
      maxBuffer: 6 * 1024 * 1024,
      env: process.env,
    });
    return {
      command: commandStr,
      ok: true,
      code: 0,
      started_at: startedAt,
      finished_at: nowIso(),
      stdout_tail: cap(stdout),
      stderr_tail: cap(stderr),
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      error: null,
    };
  } catch (err) {
    return {
      command: commandStr,
      ok: false,
      code: Number(err.code || 1),
      started_at: startedAt,
      finished_at: nowIso(),
      stdout_tail: cap(err.stdout || ""),
      stderr_tail: cap(err.stderr || ""),
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || ""),
      error: String(err.message || err),
    };
  }
}

async function pm2List(budget = null) {
  const res = await runCmd("pm2", ["jlist"], 20_000, budget, "pm2_list");
  if (!res.ok) return { processes: [], raw: res };
  try {
    const processes = JSON.parse(res.stdout);
    return { processes: Array.isArray(processes) ? processes : [], raw: res };
  } catch {
    return { processes: [], raw: res };
  }
}

function channelReadiness() {
  const env = process.env;
  return {
    discord: {
      configured: Boolean(env.DISCORD_BOT_TOKEN),
      missing: env.DISCORD_BOT_TOKEN ? [] : ["DISCORD_BOT_TOKEN"],
    },
    telegram: {
      configured: Boolean(env.TELEGRAM_BOT_TOKEN),
      missing: env.TELEGRAM_BOT_TOKEN ? [] : ["TELEGRAM_BOT_TOKEN"],
    },
    whatsapp: {
      configured: Boolean(env.WHATSAPP_TOKEN || env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_PHONE_NUMBER_ID),
      missing:
        env.WHATSAPP_TOKEN || env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_PHONE_NUMBER_ID
          ? []
          : ["WHATSAPP_TOKEN or WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID"],
    },
    reddit: {
      configured: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
      missing:
        env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
          ? []
          : ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    },
    email: {
      configured: Boolean(env.BREVO_API_KEY || env.RESEND_API_KEY || env.MAILEROO_API_KEY),
      missing: env.BREVO_API_KEY || env.RESEND_API_KEY || env.MAILEROO_API_KEY
        ? []
        : ["BREVO_API_KEY or RESEND_API_KEY or MAILEROO_API_KEY"],
    },
    github_discovery: {
      configured: true,
      missing: [],
    },
    stripe_checkout: {
      configured: Boolean(env.STRIPE_SECRET_KEY),
      missing: env.STRIPE_SECRET_KEY ? [] : ["STRIPE_SECRET_KEY"],
    },
  };
}

async function ensurePm2Process(name, budget = null) {
  const list = await pm2List(budget);
  const matches = list.processes.filter((p) => (p.name || "") === name);
  const online = matches.some((p) => p.pm2_env?.status === "online");

  if (online) {
    return { name, action: "none", ok: true, status: "online" };
  }

  if (matches.length > 0) {
    const restartRes = await runCmd("pm2", ["restart", name], 25_000, budget, "pm2_restart");
    return {
      name,
      action: "restart",
      ok: restartRes.ok,
      status: restartRes.ok ? "online_expected" : "restart_failed",
      result: restartRes,
    };
  }

  const startRes = await runCmd(
    "pm2",
    ["start", "ecosystem.background.config.js", "--only", name],
    45_000,
    budget,
    "pm2_start"
  );
  return {
    name,
    action: "start",
    ok: startRes.ok,
    status: startRes.ok ? "online_expected" : "start_failed",
    result: startRes,
  };
}

async function executeCadence(state, budget = null) {
  const runs = [];
  const discoveryDue = minutesSince(state.last_discovery_at) >= DISCOVERY_MINUTES;
  const outreachDue = minutesSince(state.last_outreach_at) >= OUTREACH_MINUTES;
  const researchDue = minutesSince(state.last_research_at) >= RESEARCH_MINUTES;
  const kaizenDue = minutesSince(state.last_kaizen_at) >= KAIZEN_MINUTES;
  const bootstrapDue = minutesSince(state.last_bootstrap_at) >= 360;

  if (bootstrapDue) {
    for (const svc of BOOTSTRAP_SERVICES) {
      const svcResult = await ensurePm2Process(svc, budget);
      runs.push({ type: "bootstrap_service", service: svc, result: svcResult });
    }
    state.last_bootstrap_at = nowIso();
  }

  if (discoveryDue) {
    const repoSeed = await runCmd("npm", ["run", "-s", "discover:bots", "--", "git"], 12 * 60 * 1000, budget, "discovery");
    const github = await runCmd("npm", ["run", "-s", "discover:bots:github"], 12 * 60 * 1000, budget, "discovery");
    const reddit = await runCmd("npm", ["run", "-s", "discover:bots:reddit"], 12 * 60 * 1000, budget, "discovery");
    runs.push({ type: "discovery_repo_seed", result: repoSeed });
    runs.push({ type: "discovery_github", result: github });
    runs.push({ type: "discovery_reddit", result: reddit });
    state.last_discovery_at = nowIso();
  }

  if (outreachDue) {
    const outreach = await runCmd("npm", ["run", "-s", "outreach:bots"], 25 * 60 * 1000, budget, "outreach");
    runs.push({ type: "outreach", result: outreach });
    state.last_outreach_at = nowIso();
  }

  if (researchDue) {
    const research = await runCmd("npm", ["run", "-s", "research:bots:daily"], 12 * 60 * 1000, budget, "research");
    runs.push({ type: "research_daily", result: research });
    state.last_research_at = nowIso();
  }

  if (kaizenDue) {
    const kaizen = await runCmd("npm", ["run", "-s", "clawpay:kaizen"], 20 * 60 * 1000, budget, "kaizen");
    runs.push({ type: "kaizen", result: kaizen });
    state.last_kaizen_at = nowIso();
  }

  return runs;
}

async function writeReport(report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stamped = path.join(REPORT_DIR, `${stamp}-clawpay-task-master.json`);
  const latest = path.join(REPORT_DIR, "clawpay-task-master-latest.json");
  const payload = JSON.stringify(report, null, 2);
  await fs.writeFile(stamped, payload);
  await fs.writeFile(latest, payload);
  return { stamped, latest };
}

function summarizeServices(processes) {
  const summary = {};
  for (const svc of ALWAYS_ON_SERVICES.concat(BOOTSTRAP_SERVICES)) {
    const matches = processes.filter((p) => (p.name || "") === svc);
    summary[svc] = {
      count: matches.length,
      online: matches.filter((p) => p.pm2_env?.status === "online").length,
      statuses: [...new Set(matches.map((p) => p.pm2_env?.status || "unknown"))],
    };
  }
  return summary;
}

async function runCycle(state) {
  const start = nowIso();
  const budget = createRunBudget();
  console.log(`[clawpay-task-master] cycle start ${start}`);

  const ensureResults = [];
  for (const svc of ALWAYS_ON_SERVICES) {
    ensureResults.push(await ensurePm2Process(svc, budget));
  }

  const listAfter = await pm2List(budget);
  const cadenceRuns = await executeCadence(state, budget);

  state.cycles += 1;

  const report = {
    ok: true,
    cycle_started_at: start,
    cycle_finished_at: nowIso(),
    cycle_number: state.cycles,
    config: {
      loop_seconds: LOOP_SECONDS,
      discovery_every_minutes: DISCOVERY_MINUTES,
      outreach_every_minutes: OUTREACH_MINUTES,
      research_every_minutes: RESEARCH_MINUTES,
      kaizen_every_minutes: KAIZEN_MINUTES,
    },
    services: summarizeServices(listAfter.processes),
    always_on_recovery: ensureResults,
    channel_readiness: channelReadiness(),
    cadence_runs: cadenceRuns,
    budget: budget.snapshot(),
    state,
  };
  report.ok = report.budget.ok
    && !report.cadence_runs.some((r) => r?.result?.blocked_by_budget)
    && !report.always_on_recovery.some((r) => r?.result?.blocked_by_budget);

  const files = await writeReport(report);
  console.log(`[clawpay-task-master] cycle report written: ${path.relative(ROOT, files.latest)}`);
  return { report, files };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await ensureDirs();
  const state = await loadState();
  const once = process.argv.includes("--once");

  console.log(`[clawpay-task-master] started at ${nowIso()} (loop=${LOOP_SECONDS}s, once=${once})`);

  while (true) {
    try {
      const { report, files } = await runCycle(state);
      await saveState(state);
      console.log(
        `[clawpay-task-master] cycle ${report.cycle_number} complete | report=${path.relative(ROOT, files.latest)}`
      );
    } catch (err) {
      console.error(`[clawpay-task-master] cycle failure: ${err.message}`);
    }

    if (once) break;
    await sleep(LOOP_SECONDS * 1000);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[clawpay-task-master] fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  runCycle,
  loadState,
  saveState,
  channelReadiness,
};

#!/usr/bin/env node
"use strict";

/**
 * clawpay-kaizen-swarm.js
 *
 * Continuous ClawPay improvement loop:
 * - Benchmarks payment velocity vs target
 * - Runs learning + auto-improvement loops
 * - Optionally triggers discovery/outreach when below benchmark
 * - Writes a machine-readable report for daily review
 */

require("dotenv").config({ override: true });

const { spawnSync } = require("child_process");
const fsp = require("fs/promises");
const path = require("path");
const { createToolBudget } = require("../control/mcp-tool-budget");
const {
  getConversionStats,
  getFunnelMetrics,
  getRevenueProjection,
} = require("./bot-conversion-tracker");
const { runDailyLearning } = require("./bot-learning-system");
const { runAutoImprovementCycle } = require("./bot-auto-improvement");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const TARGET_CREDITS = Number(process.env.CLAWPAY_TARGET_CREDITS || "100000");
const TARGET_DAYS = Number(process.env.CLAWPAY_TARGET_DAYS || "90");
const EXECUTE_ACTIONS = String(process.env.CLAWPAY_KAIZEN_EXECUTE || "true").toLowerCase() === "true";
const RUN_DAILY_LEARNING = String(process.env.CLAWPAY_KAIZEN_RUN_LEARNING || "true").toLowerCase() === "true";

function createRunBudget() {
  return createToolBudget({
    maxCalls: Number(process.env.CLAWPAY_KAIZEN_TOOL_BUDGET_MAX_CALLS || process.env.MCP_TOOL_BUDGET_MAX_CALLS || 50),
    maxTokensPerTool: Number(process.env.CLAWPAY_KAIZEN_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || 12000),
    maxTokensTotal: Number(process.env.CLAWPAY_KAIZEN_TOOL_BUDGET_MAX_TOKENS_TOTAL || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_TOTAL || 100000),
  });
}

function runCommand(cmd, args = [], budget = null, toolName = "shell_command") {
  const commandStr = [cmd, ...args].join(" ");
  const guard = budget ? budget.record(toolName, commandStr) : { allowed: true, violations: [] };
  if (!guard.allowed) {
    return {
      ok: false,
      blocked_by_budget: true,
      code: 429,
      signal: null,
      stdout_tail: "",
      stderr_tail: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
    };
  }
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20 * 60 * 1000,
  });
  return {
    ok: res.status === 0,
    code: res.status,
    signal: res.signal,
    stdout_tail: String(res.stdout || "").trim().split("\n").slice(-30).join("\n"),
    stderr_tail: String(res.stderr || "").trim().split("\n").slice(-30).join("\n"),
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function writeReport(report) {
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(REPORTS_DIR, `${stamp}-clawpay-kaizen-swarm.json`);
  const latest = path.join(REPORTS_DIR, "clawpay-kaizen-swarm-latest.json");
  await fsp.writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  await fsp.writeFile(latest, `${JSON.stringify(report, null, 2)}\n`);
  return { file, latest };
}

async function main() {
  const budget = createRunBudget();
  const now = new Date();
  const stats = await getConversionStats(30);
  const funnel = await getFunnelMetrics(30);
  const projection = await getRevenueProjection();

  const totalRevenue = Number(stats?.total_revenue || 0);
  const revenue24h = Number(stats?.revenue_today || 0);
  const conversions24h = Number(stats?.conversions_today || 0);
  const daysElapsed = Number(stats?.days_elapsed || 0);
  const daysRemaining = Math.max(1, TARGET_DAYS - daysElapsed);
  const remaining = Math.max(0, TARGET_CREDITS - totalRevenue);
  const dailyNeeded = remaining / daysRemaining;
  const progressPct = TARGET_CREDITS > 0 ? (totalRevenue / TARGET_CREDITS) * 100 : 0;

  const benchmark = {
    target_credits: TARGET_CREDITS,
    target_days: TARGET_DAYS,
    total_revenue: totalRevenue,
    conversions_24h: conversions24h,
    revenue_24h: revenue24h,
    daily_needed: Number(dailyNeeded.toFixed(2)),
    progress_percent: Number(progressPct.toFixed(2)),
    behind: revenue24h < dailyNeeded,
  };

  const actions = [];
  const actionResults = [];

  // Payment velocity too low: push top-of-funnel activity.
  if (benchmark.behind || conversions24h === 0) {
    actions.push({
      action: "discovery_refresh",
      reason: "payment velocity below target",
      command: "node scripts/bot-lead-discovery.js all",
    });
    actions.push({
      action: "discovery_github_enrichment",
      reason: "expand external discovery sources",
      command: "npm run -s discover:bots:github",
    });
    actions.push({
      action: "discovery_reddit_enrichment",
      reason: "expand external discovery sources",
      command: "npm run -s discover:bots:reddit",
    });
    actions.push({
      action: "moltbook_forum_harvest",
      reason: "harvest bot-intent posts and queue high-score leads",
      command: "npm run -s harvest:moltbook",
    });
    actions.push({
      action: "outreach_push",
      reason: "payment velocity below target",
      command: "node scripts/bot-outreach.js",
    });
    actions.push({
      action: "research_snapshot",
      reason: "publish A/B/C findings and outliers",
      command: "npm run -s research:bots:daily",
    });
  }

  // Always run adaptive loops.
  actions.push({
    action: "auto_improvement_cycle",
    reason: "continuous kaizen",
    command: "internal:runAutoImprovementCycle",
  });

  if (RUN_DAILY_LEARNING) {
    actions.push({
      action: "learning_cycle",
      reason: "message optimization",
      command: "internal:runDailyLearning",
    });
  }

  for (const a of actions) {
    if (!EXECUTE_ACTIONS) {
      actionResults.push({ ...a, executed: false, ok: true, skipped: true });
      continue;
    }

    if (a.command === "internal:runAutoImprovementCycle") {
      const guard = budget.record("internal_kaizen", a.command);
      if (!guard.allowed) {
        actionResults.push({
          ...a,
          executed: false,
          ok: false,
          blocked_by_budget: true,
          error: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
        });
        continue;
      }
      try {
        const result = await runAutoImprovementCycle();
        actionResults.push({
          ...a,
          executed: true,
          ok: true,
          summary: {
            goal_progress_percent: Number(result?.goal?.progress_percent || 0),
            daily_needed: Number(result?.goal?.daily_needed || 0),
            daily_actual: Number(result?.goal?.daily_actual || 0),
          },
        });
      } catch (err) {
        actionResults.push({ ...a, executed: true, ok: false, error: err.message });
      }
      continue;
    }

    if (a.command === "internal:runDailyLearning") {
      const guard = budget.record("internal_learning", a.command);
      if (!guard.allowed) {
        actionResults.push({
          ...a,
          executed: false,
          ok: false,
          blocked_by_budget: true,
          error: `tool_budget_exceeded: ${guard.violations.join(", ")}`,
        });
        continue;
      }
      try {
        await runDailyLearning();
        actionResults.push({ ...a, executed: true, ok: true });
      } catch (err) {
        actionResults.push({ ...a, executed: true, ok: false, error: err.message });
      }
      continue;
    }

    const [cmd, ...rest] = a.command.trim().split(/\s+/);
    const res = runCommand(cmd, rest, budget, "kaizen_action");
    actionResults.push({ ...a, executed: true, ...res });
  }

  const successRate =
    actionResults.length > 0
      ? actionResults.filter((x) => x.ok).length / actionResults.length
      : 1;

  const nextRunMinutes = clamp(Math.round(60 * (benchmark.behind ? 0.5 : 1.5)), 30, 120);

  const report = {
    ok: true,
    generated_at: now.toISOString(),
    mode: {
      execute_actions: EXECUTE_ACTIONS,
      run_daily_learning: RUN_DAILY_LEARNING,
    },
    benchmark,
    funnel: {
      overall_conversion: Number(funnel?.overall_conversion || 0),
      sent: Number(funnel?.total_sent || 0),
      responded: Number(funnel?.total_responded || 0),
      converted: Number(funnel?.total_converted || 0),
    },
    projection: projection || null,
    actions,
    action_results: actionResults,
    budget: budget.snapshot(),
    loop_health: {
      action_success_rate: Number((successRate * 100).toFixed(2)),
      next_run_recommended_minutes: nextRunMinutes,
    },
  };
  report.ok = report.budget.ok && !report.action_results.some((x) => x.blocked_by_budget);

  const files = await writeReport(report);
  console.log(
    JSON.stringify(
      {
        ok: true,
        benchmark,
        action_success_rate_pct: report.loop_health.action_success_rate,
        report: files.file,
        latest: files.latest,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[clawpay-kaizen-swarm] fatal:", err.message || String(err));
  process.exit(1);
});

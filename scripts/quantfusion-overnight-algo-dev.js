#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const REPORTS_DIR = path.join(__dirname, "reports");
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const OUTCOME_WINDOW_HOURS = Math.max(1, Number(process.env.QUANT_OUTCOME_WINDOW_HOURS || "24") || 24);
const args = process.argv.slice(2);

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function has(flag) {
  return args.includes(flag);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks WHERE idempotency_key=$1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload, priority = 5, dryRun = false) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});

  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", type, idempotencyKey };
  }

  if (dryRun) {
    return { created: true, dry_run: true, type, payload, priority, idempotencyKey };
  }

  const id = uuid();
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
    [id, type, JSON.stringify(payload || {}), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, priority };
}

async function getQuantfusionRepo() {
  const { rows } = await pg.query(
    `SELECT id, client_name, repo_url, local_path
       FROM managed_repos
      WHERE status='active' AND lower(client_name)='quantfusion'
      LIMIT 1`
  );
  return rows[0] || null;
}

function resultExcerpt(result) {
  if (!result || typeof result !== "object") return null;
  const keys = [
    "ok",
    "status",
    "summary",
    "symbol",
    "timeframe",
    "signals_found",
    "orders_created",
    "trades_opened",
    "trades_closed",
    "pnl",
    "win_rate",
    "sharpe",
    "max_drawdown",
  ];
  const out = {};
  for (const k of keys) {
    if (result[k] != null) out[k] = result[k];
  }
  return Object.keys(out).length ? out : null;
}

async function collectDownstreamOutcomes(agentId) {
  const { rows } = await pg.query(
    `SELECT
       id, type, status, created_at, completed_at, last_error, result
     FROM tasks
     WHERE COALESCE(payload->>'source','') = 'quantfusion_overnight_algo_dev'
       AND COALESCE(payload->>'agent_id','') = $1
       AND created_at >= NOW() - ($2::text || ' hours')::interval
     ORDER BY created_at DESC
     LIMIT 500`,
    [agentId, String(OUTCOME_WINDOW_HOURS)]
  );

  const summary = {};
  for (const row of rows) {
    const type = String(row.type || "unknown");
    if (!summary[type]) summary[type] = { total: 0 };
    summary[type].total += 1;
    const s = String(row.status || "unknown").toLowerCase();
    summary[type][s] = (summary[type][s] || 0) + 1;
  }

  const latestFailures = rows
    .filter((r) => ["failed", "dead_letter"].includes(String(r.status || "").toLowerCase()))
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
      last_error: r.last_error ? String(r.last_error).slice(0, 300) : null,
      result_excerpt: resultExcerpt(r.result),
    }));

  const latestDecisions = rows
    .filter((r) => ["quant_trading_signal_scan", "quant_trading_execute_orders", "quant_trading_daily_summary"].includes(String(r.type || "")))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      created_at: r.created_at,
      result_excerpt: resultExcerpt(r.result),
    }));

  return {
    window_hours: OUTCOME_WINDOW_HOURS,
    summary,
    latest_failures: latestFailures,
    latest_decisions: latestDecisions,
  };
}

async function main() {
  const dryRun = has("--dry-run");
  const mode = String(arg("--mode", process.env.QUANT_MODE || "paper")).toLowerCase() === "live" ? "live" : "paper";
  const agentId = String(arg("--agent", process.env.QUANT_AGENT_ID || "quantfusion-core"));
  const symbols = String(arg("--symbols", process.env.QUANT_SYMBOLS || "SPY,QQQ,BTCUSD")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const runDate = dateStamp();

  await ensureRoutingColumns();
  const repo = await getQuantfusionRepo();
  const queued = [];

  queued.push(await createTaskIfNeeded("quant_trading_daily_summary", {
    agent_id: agentId,
    metric_date: runDate,
    source: "quantfusion_overnight_algo_dev",
    phase: "review_performance",
  }, 5, dryRun));

  queued.push(await createTaskIfNeeded("quant_trading_backtest", {
    agent_id: agentId,
    symbol: symbols[0] || "SPY",
    timeframe: "15m",
    source: "quantfusion_overnight_algo_dev",
    phase: "edge_case_backtest",
  }, 5, dryRun));

  queued.push(await createTaskIfNeeded("quant_trading_signal_scan", {
    agent_id: agentId,
    mode,
    symbols,
    timeframe: "15m",
    source: "quantfusion_overnight_algo_dev",
    phase: "propose_strategy_improvements",
  }, 5, dryRun));

  queued.push(await createTaskIfNeeded("quant_trading_execute_orders", {
    agent_id: agentId,
    mode: "paper",
    confirm_live: false,
    account_equity_usd: Number(process.env.QUANT_EQUITY_USD || 10000),
    limit: 10,
    source: "quantfusion_overnight_algo_dev",
    phase: "paper_validation",
  }, 5, dryRun));

  if (repo) {
    queued.push(await createTaskIfNeeded("opencode_controller", {
      repo: repo.client_name,
      source: "quantfusion_overnight_algo_dev",
      objective: "Overnight algo development loop: review today's trading outcomes, identify loss-causing bugs/edge cases, implement strategy/risk improvements in quantfusion repo, run backtests, and produce a morning changelog with rationale and rollback notes.",
      references: [
        "https://x.com/fxnction/status/2026536533734359402"
      ],
      max_iterations: 5,
      quality_target: 96,
      auto_iterate: true,
    }, 5, dryRun));
  }

  const downstream = await collectDownstreamOutcomes(agentId);

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    agent_id: agentId,
    mode,
    run_date: runDate,
    quantfusion_repo: repo ? { client_name: repo.client_name, local_path: repo.local_path } : null,
    queued,
    created_count: queued.filter((q) => q.created).length,
    skipped_duplicates: queued.filter((q) => !q.created).length,
    downstream_outcomes: downstream,
    signal_scan_completed: Number(downstream.summary?.quant_trading_signal_scan?.completed || 0),
    execute_completed: Number(downstream.summary?.quant_trading_execute_orders?.completed || 0),
    daily_summary_completed: Number(downstream.summary?.quant_trading_daily_summary?.completed || 0),
    backtest_completed: Number(downstream.summary?.quant_trading_backtest?.completed || 0),
    downstream_latest_failures: Array.isArray(downstream.latest_failures) ? downstream.latest_failures.length : 0,
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `${stamp}-quantfusion-overnight-algo-dev.json`);
  const latestPath = path.join(REPORTS_DIR, "quantfusion-overnight-algo-dev-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    created_count: report.created_count,
    skipped_duplicates: report.skipped_duplicates,
    signal_scan_completed: report.signal_scan_completed,
    execute_completed: report.execute_completed,
    daily_summary_completed: report.daily_summary_completed,
    backtest_completed: report.backtest_completed,
    downstream_latest_failures: report.downstream_latest_failures,
    report_path: reportPath,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("[quantfusion-overnight-algo-dev] fatal:", err.message || String(err));
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { v4: uuid } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const args = process.argv.slice(2);

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function has(flag) {
  return args.includes(flag);
}

function parseSymbols(v, fallback = "SPY,QQQ,BTCUSD") {
  return String(v || fallback)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function floorToWindowISO(dt = new Date(), mins = 5) {
  const d = new Date(dt);
  d.setUTCSeconds(0, 0);
  const m = d.getUTCMinutes();
  d.setUTCMinutes(m - (m % mins));
  return d.toISOString();
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
      WHERE status='active'
        AND lower(client_name)='quantfusion'
      LIMIT 1`
  );
  return rows[0] || null;
}

async function main() {
  const dryRun = has("--dry-run");
  const includeOpencode = !has("--no-opencode");
  const windowStart = floorToWindowISO(new Date(), Number(arg("--window-min", "5")) || 5);
  const mode = String(arg("--mode", process.env.QUANT_MODE || "paper")).toLowerCase() === "live" ? "live" : "paper";
  const symbols = parseSymbols(arg("--symbols", process.env.QUANT_SYMBOLS || "SPY,QQQ,BTCUSD"));
  const timeframe = String(arg("--timeframe", process.env.QUANT_TIMEFRAME || "15m"));
  const agentId = String(arg("--agent", process.env.QUANT_AGENT_ID || "quantfusion-core"));
  const equity = Number(arg("--equity", process.env.QUANT_EQUITY_USD || "10000")) || 10000;

  await ensureRoutingColumns();
  const repo = await getQuantfusionRepo();

  const queued = [];

  queued.push(await createTaskIfNeeded("quant_trading_signal_scan", {
    agent_id: agentId,
    mode,
    symbols,
    timeframe,
    source: "quantfusion_trading_queue",
    window_start: windowStart,
  }, 5, dryRun));

  queued.push(await createTaskIfNeeded("quant_trading_execute_orders", {
    agent_id: agentId,
    mode,
    account_equity_usd: equity,
    confirm_live: has("--confirm-live"),
    source: "quantfusion_trading_queue",
    window_start: windowStart,
    limit: Number(arg("--limit", "5")) || 5,
  }, 5, dryRun));

  if (has("--daily-summary")) {
    queued.push(await createTaskIfNeeded("quant_trading_daily_summary", {
      agent_id: agentId,
      metric_date: new Date().toISOString().slice(0, 10),
      source: "quantfusion_trading_queue",
      window_start: windowStart,
    }, 4, dryRun));
  }

  if (has("--pause")) {
    queued.push(await createTaskIfNeeded("quant_trading_pause", {
      agent_id: agentId,
      reason: arg("--reason", "manual pause from queue"),
      actor: "quantfusion_trading_queue",
      source: "quantfusion_trading_queue",
      window_start: windowStart,
    }, 6, dryRun));
  }

  if (has("--resume")) {
    queued.push(await createTaskIfNeeded("quant_trading_resume", {
      agent_id: agentId,
      actor: "quantfusion_trading_queue",
      source: "quantfusion_trading_queue",
      window_start: windowStart,
    }, 6, dryRun));
  }

  if (includeOpencode && repo) {
    queued.push(await createTaskIfNeeded("opencode_controller", {
      repo: repo.client_name,
      source: "quantfusion_trading_queue",
      objective: "Implement and harden autonomous prediction/speculation trading workflow in quantfusion: paper trading first, clear entry/exit rules, strict risk controls, logging with reasoning, alerting, pause/override control, and daily PnL analytics dashboard.",
      references: [
        "https://x.com/fxnction/status/2026536533734359402",
        "https://github.com/smanthey/quantfusion",
        "https://github.com/arturoabreuhd/pinescript-ai",
        "https://github.com/financial-datasets/mcp-server"
      ],
      max_iterations: 5,
      quality_target: 96,
      auto_iterate: true,
    }, 5, dryRun));
  }

  const createdCount = queued.filter((q) => q.created).length;
  const skipped = queued.length - createdCount;

  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    mode,
    agent_id: agentId,
    symbols,
    timeframe,
    window_start: windowStart,
    quantfusion_repo_found: !!repo,
    created_count: createdCount,
    skipped_duplicates: skipped,
    queued,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("[quantfusion-trading-queue] fatal:", err.message || String(err));
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

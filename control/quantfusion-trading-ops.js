"use strict";

const path = require("path");
const fs = require("fs");
const pg = require("../infra/postgres");
const { notifyMonitoring } = require("./monitoring-notify");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const AGENT_ID_DEFAULT = "quantfusion-core";

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function round(v, d = 6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

function envBool(name, fallback = false) {
  const v = String(process.env[name] || "").toLowerCase();
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v);
}

function toDateISO(d = new Date()) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return new Date().toISOString().slice(0, 10);
  return x.toISOString().slice(0, 10);
}

function safeJson(v) {
  try {
    return JSON.parse(JSON.stringify(v || {}));
  } catch {
    return {};
  }
}

async function ensureSchema() {
  const pg = require("../infra/postgres");
  // Check if migration has been applied
  const { rows } = await pg.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'quantfusion_trading_signals'
    ) as exists
  `);
  
  if (!rows[0].exists) {
    throw new Error('Migration 072 must be applied first. Run: node scripts/run-migrations.js --only 072');
  }
}

async function loadAgentConfig(agentId = AGENT_ID_DEFAULT) {
  await ensureSchema();

  await pg.query(
    `INSERT INTO trading_agent_config (agent_id)
     VALUES ($1)
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId]
  );

  const { rows } = await pg.query(
    `SELECT * FROM trading_agent_config WHERE agent_id = $1`,
    [agentId]
  );

  const row = rows[0] || {};
  return {
    agent_id: row.agent_id || agentId,
    mode: String(row.mode || "paper"),
    is_paused: !!row.is_paused,
    pause_reason: row.pause_reason || null,
    risk_per_trade_pct: Number(row.risk_per_trade_pct || 1),
    max_position_notional_pct: Number(row.max_position_notional_pct || 10),
    daily_loss_limit_pct: Number(row.daily_loss_limit_pct || 3),
    max_drawdown_pct: Number(row.max_drawdown_pct || 8),
    allowed_symbols: Array.isArray(row.allowed_symbols) ? row.allowed_symbols : [],
    settings: row.settings || {},
    updated_at: row.updated_at || null,
  };
}

async function updateAgentConfig(agentId = AGENT_ID_DEFAULT, patch = {}) {
  const existing = await loadAgentConfig(agentId);
  const merged = {
    mode: ["paper", "live"].includes(String(patch.mode || existing.mode)) ? String(patch.mode || existing.mode) : "paper",
    is_paused: patch.is_paused === undefined ? existing.is_paused : !!patch.is_paused,
    pause_reason: patch.pause_reason === undefined ? existing.pause_reason : (patch.pause_reason || null),
    risk_per_trade_pct: clampNumber(patch.risk_per_trade_pct ?? existing.risk_per_trade_pct, 0.1, 10, 1),
    max_position_notional_pct: clampNumber(patch.max_position_notional_pct ?? existing.max_position_notional_pct, 1, 100, 10),
    daily_loss_limit_pct: clampNumber(patch.daily_loss_limit_pct ?? existing.daily_loss_limit_pct, 0.1, 50, 3),
    max_drawdown_pct: clampNumber(patch.max_drawdown_pct ?? existing.max_drawdown_pct, 0.5, 90, 8),
    allowed_symbols: Array.isArray(patch.allowed_symbols) ? patch.allowed_symbols.map(String) : existing.allowed_symbols,
    settings: { ...(existing.settings || {}), ...(safeJson(patch.settings || {})) },
  };

  await pg.query(
    `UPDATE trading_agent_config
        SET mode = $2,
            is_paused = $3,
            pause_reason = $4,
            risk_per_trade_pct = $5,
            max_position_notional_pct = $6,
            daily_loss_limit_pct = $7,
            max_drawdown_pct = $8,
            allowed_symbols = $9,
            settings = $10::jsonb,
            updated_at = NOW()
      WHERE agent_id = $1`,
    [
      agentId,
      merged.mode,
      merged.is_paused,
      merged.pause_reason,
      merged.risk_per_trade_pct,
      merged.max_position_notional_pct,
      merged.daily_loss_limit_pct,
      merged.max_drawdown_pct,
      merged.allowed_symbols,
      JSON.stringify(merged.settings),
    ]
  );

  return loadAgentConfig(agentId);
}

async function logEvent({ agent_id, severity = "info", event_type, message, payload = {} }) {
  await pg.query(
    `INSERT INTO trading_events (agent_id, severity, event_type, message, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [agent_id, severity, event_type, message, JSON.stringify(payload || {})]
  );

  if (severity === "critical" || severity === "warning") {
    await notifyMonitoring(
      [
        "📈 *QuantFusion Trading Event*",
        `agent: \`${agent_id}\``,
        `severity: *${severity.toUpperCase()}*`,
        `event: \`${event_type}\``,
        message,
      ].join("\n")
    ).catch(() => {});
  }
}

async function fetchOpenAlgoQuote(symbol) {
  const base = String(process.env.OPENALGO_BASE_URL || "").trim();
  if (!base || !symbol) return null;

  const apiKey = String(process.env.OPENALGO_API_KEY || "").trim();
  const url = `${base.replace(/\/$/, "")}/market/quote?symbol=${encodeURIComponent(symbol)}`;
  const headers = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json) return null;
    return {
      symbol,
      price: Number(json.price || json.last || json.ltp || 0),
      ema_fast: Number(json.ema_fast || json.ema20 || json.ma_fast || 0),
      ema_slow: Number(json.ema_slow || json.ema50 || json.ma_slow || 0),
      rsi: Number(json.rsi || 50),
      atr: Number(json.atr || 0),
      day_high: Number(json.day_high || json.high || 0),
      day_low: Number(json.day_low || json.low || 0),
      source: "openalgo",
      raw: json,
    };
  } catch {
    return null;
  }
}

function normalizeSnapshot(payload = {}) {
  const p = payload.market || payload.snapshot || payload;
  const price = Number(p.price || p.last_price || p.last || 0);
  return {
    symbol: String(p.symbol || payload.symbol || "").toUpperCase(),
    price,
    ema_fast: Number(p.ema_fast || p.ema20 || p.ma_fast || price || 0),
    ema_slow: Number(p.ema_slow || p.ema50 || p.ma_slow || price || 0),
    rsi: Number(p.rsi || 50),
    atr: Number(p.atr || (price > 0 ? price * 0.01 : 0)),
    day_high: Number(p.day_high || p.high || price || 0),
    day_low: Number(p.day_low || p.low || price || 0),
    timeframe: String(p.timeframe || payload.timeframe || "15m"),
    source: p.source || "payload",
    raw: safeJson(p),
  };
}

function deriveSignal(snapshot) {
  const price = Number(snapshot.price || 0);
  const fast = Number(snapshot.ema_fast || 0);
  const slow = Number(snapshot.ema_slow || 0);
  const rsi = Number(snapshot.rsi || 50);
  const atr = Math.max(Number(snapshot.atr || 0), price * 0.003);

  if (!(price > 0)) {
    return { side: "NONE", strength: 0, reason: "No valid price in snapshot", stop: null, takeProfit: null };
  }

  let side = "NONE";
  let strength = 0;
  let reason = "No entry criteria met";

  if (price > fast && fast >= slow && rsi >= 45 && rsi <= 72) {
    side = "LONG";
    strength = round(((price - slow) / Math.max(price, 1)) * 6 + (72 - rsi) / 60, 4);
    reason = "Trend-follow long: price above EMA fast/slow with healthy RSI";
  } else if (price < fast && fast <= slow && rsi >= 28 && rsi <= 55) {
    side = "SHORT";
    strength = round(((slow - price) / Math.max(price, 1)) * 6 + (rsi - 28) / 60, 4);
    reason = "Trend-follow short: price below EMA fast/slow with non-extreme RSI";
  } else if (rsi <= 24 && price >= slow * 0.98) {
    side = "LONG";
    strength = round((25 - rsi) / 25, 4);
    reason = "Mean-reversion long: oversold RSI near trend support";
  } else if (rsi >= 80 && price <= slow * 1.03) {
    side = "SHORT";
    strength = round((rsi - 80) / 20, 4);
    reason = "Mean-reversion short: overbought RSI near trend resistance";
  }

  if (side === "NONE") {
    return { side, strength: 0, reason, stop: null, takeProfit: null };
  }

  const stopDistance = Math.max(atr * 1.5, price * 0.0075);
  const stop = side === "LONG" ? price - stopDistance : price + stopDistance;
  const takeProfit = side === "LONG" ? price + stopDistance * 2 : price - stopDistance * 2;

  return {
    side,
    strength: clampNumber(strength, 0.05, 1, 0.2),
    reason,
    stop: round(stop, 8),
    takeProfit: round(takeProfit, 8),
  };
}

function computePositionSize({ equityUsd, price, stopLoss, side, riskPct, maxNotionalPct }) {
  const entry = Number(price || 0);
  const stop = Number(stopLoss || 0);
  if (!(entry > 0 && stop > 0)) return { qty: 0, riskUsd: 0, notionalUsd: 0, stopDistance: 0 };

  const stopDistance = Math.abs(entry - stop);
  if (!(stopDistance > 0)) return { qty: 0, riskUsd: 0, notionalUsd: 0, stopDistance: 0 };

  const riskBudget = Math.max(0, Number(equityUsd || 0) * (Number(riskPct || 1) / 100));
  const maxNotional = Math.max(0, Number(equityUsd || 0) * (Number(maxNotionalPct || 10) / 100));
  if (!(riskBudget > 0 && maxNotional > 0)) return { qty: 0, riskUsd: 0, notionalUsd: 0, stopDistance };

  const qtyByRisk = riskBudget / stopDistance;
  const qtyByNotional = maxNotional / entry;
  const qty = Math.max(0, Math.min(qtyByRisk, qtyByNotional));
  const notionalUsd = qty * entry;
  const riskUsd = qty * stopDistance;

  return {
    qty: round(qty, 8),
    riskUsd: round(riskUsd, 8),
    notionalUsd: round(notionalUsd, 8),
    stopDistance: round(stopDistance, 8),
    side,
  };
}

async function realizedPnlToday(agentId) {
  const { rows } = await pg.query(
    `SELECT COALESCE(SUM(pnl_usd),0)::numeric AS pnl
       FROM trading_orders
      WHERE agent_id = $1
        AND status = 'CLOSED'
        AND closed_at >= date_trunc('day', NOW())`,
    [agentId]
  );
  return Number(rows[0]?.pnl || 0);
}

async function computeMaxDrawdownPct(agentId, lookbackDays = 90) {
  const { rows } = await pg.query(
    `WITH pnl AS (
       SELECT COALESCE(closed_at::date, opened_at::date) AS d,
              SUM(COALESCE(pnl_usd,0))::numeric AS day_pnl
         FROM trading_orders
        WHERE agent_id = $1
          AND status = 'CLOSED'
          AND COALESCE(closed_at, opened_at) >= NOW() - ($2::text || ' days')::interval
        GROUP BY 1
        ORDER BY 1
     ),
     eq AS (
       SELECT d,
              SUM(day_pnl) OVER (ORDER BY d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS equity
         FROM pnl
     ),
     dd AS (
       SELECT d,
              equity,
              MAX(equity) OVER (ORDER BY d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak
         FROM eq
     )
     SELECT COALESCE(MAX(CASE WHEN peak = 0 THEN 0 ELSE ((peak - equity) / NULLIF(ABS(peak),0)) * 100 END),0)::numeric AS max_dd_pct
       FROM dd`,
    [agentId, String(lookbackDays)]
  );

  return Number(rows[0]?.max_dd_pct || 0);
}

async function runSignalScan(payload = {}) {
  await ensureSchema();

  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const cfg = await loadAgentConfig(agentId);
  if (cfg.is_paused) {
    return {
      ok: true,
      paused: true,
      reason: cfg.pause_reason || "agent paused",
      agent_id: agentId,
    };
  }

  const symbols = Array.isArray(payload.symbols) && payload.symbols.length
    ? payload.symbols.map((s) => String(s).toUpperCase())
    : (cfg.allowed_symbols.length ? cfg.allowed_symbols : ["SPY"]);

  const timeframe = String(payload.timeframe || "15m");
  const snapshots = [];
  const createdSignals = [];

  for (const symbol of symbols) {
    let snap = normalizeSnapshot({ ...payload, symbol, timeframe });
    if (!(snap.price > 0)) {
      const remote = await fetchOpenAlgoQuote(symbol);
      if (remote) {
        snap = normalizeSnapshot({ ...remote, symbol, timeframe, source: remote.source });
      }
    }

    snapshots.push(snap);
    const signal = deriveSignal(snap);

    const ins = await pg.query(
      `INSERT INTO trading_signals
        (agent_id, symbol, timeframe, signal_side, signal_strength, entry_price, stop_loss, take_profit, reasoning, market_snapshot, status)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       RETURNING id, symbol, signal_side, signal_strength, entry_price, stop_loss, take_profit, status, created_at`,
      [
        agentId,
        symbol,
        timeframe,
        signal.side,
        signal.strength,
        snap.price || null,
        signal.stop,
        signal.takeProfit,
        signal.reason,
        JSON.stringify(snap),
        signal.side === "NONE" ? "SKIPPED" : "NEW",
      ]
    );

    const row = ins.rows[0];
    createdSignals.push(row);

    if (signal.side !== "NONE") {
      await logEvent({
        agent_id: agentId,
        severity: signal.strength >= 0.6 ? "warning" : "info",
        event_type: "signal_created",
        message: `${symbol} ${signal.side} signal (${timeframe}) strength=${signal.strength}`,
        payload: {
          signal_id: row.id,
          symbol,
          side: signal.side,
          strength: signal.strength,
          stop: signal.stop,
          take_profit: signal.takeProfit,
        },
      });
    }
  }

  return {
    ok: true,
    agent_id: agentId,
    mode: cfg.mode,
    timeframe,
    symbols,
    signals_total: createdSignals.length,
    actionable_signals: createdSignals.filter((s) => s.signal_side !== "NONE").length,
    snapshots,
    signals: createdSignals,
  };
}

async function enforceRiskGates(agentId, cfg, equityUsd) {
  const pnlToday = await realizedPnlToday(agentId);
  const maxDdPct = await computeMaxDrawdownPct(agentId, 90);

  const dailyLossPct = equityUsd > 0 ? Math.abs(Math.min(0, pnlToday)) / equityUsd * 100 : 0;
  const hitDailyLoss = dailyLossPct >= Number(cfg.daily_loss_limit_pct || 3);
  const hitDrawdown = maxDdPct >= Number(cfg.max_drawdown_pct || 8);

  if (hitDailyLoss || hitDrawdown) {
    const reason = hitDailyLoss
      ? `daily loss limit reached (${round(dailyLossPct, 4)}% >= ${cfg.daily_loss_limit_pct}%)`
      : `max drawdown reached (${round(maxDdPct, 4)}% >= ${cfg.max_drawdown_pct}%)`;

    await updateAgentConfig(agentId, {
      is_paused: true,
      pause_reason: reason,
    });

    await logEvent({
      agent_id: agentId,
      severity: "critical",
      event_type: "risk_gate_pause",
      message: `Trading paused automatically: ${reason}`,
      payload: {
        pnl_today_usd: pnlToday,
        daily_loss_pct: round(dailyLossPct, 4),
        max_drawdown_pct: round(maxDdPct, 4),
      },
    });

    return {
      allowed: false,
      reason,
      pnl_today_usd: pnlToday,
      daily_loss_pct: round(dailyLossPct, 4),
      max_drawdown_pct: round(maxDdPct, 4),
    };
  }

  return {
    allowed: true,
    pnl_today_usd: pnlToday,
    daily_loss_pct: round(dailyLossPct, 4),
    max_drawdown_pct: round(maxDdPct, 4),
  };
}

async function placeOpenAlgoOrder({ symbol, side, qty, mode, stop_loss, take_profit, metadata = {} }) {
  const base = String(process.env.OPENALGO_BASE_URL || "").trim();
  if (!base) {
    return { ok: false, error: "openalgo_base_missing" };
  }

  const apiKey = String(process.env.OPENALGO_API_KEY || "").trim();
  const url = `${base.replace(/\/$/, "")}/orders`;
  const headers = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const body = {
    symbol,
    side,
    qty,
    mode,
    stop_loss,
    take_profit,
    metadata,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.message || `http_${res.status}`, raw: json };
    }
    return { ok: true, raw: json, order_id: json?.order_id || json?.id || null };
  } catch (err) {
    return { ok: false, error: err.message || "network_error" };
  }
}

async function executeOrders(payload = {}) {
  await ensureSchema();

  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const cfg = await loadAgentConfig(agentId);
  if (cfg.is_paused) {
    return { ok: true, paused: true, reason: cfg.pause_reason || "agent paused", agent_id: agentId };
  }

  const mode = String(payload.mode || cfg.mode || "paper");
  const equityUsd = clampNumber(
    payload.account_equity_usd ?? cfg.settings?.account_equity_usd ?? process.env.QUANT_EQUITY_USD,
    10,
    100000000,
    10000
  );

  const riskGate = await enforceRiskGates(agentId, cfg, equityUsd);
  if (!riskGate.allowed) {
    return { ok: true, blocked: true, risk_gate: riskGate, agent_id: agentId };
  }

  const limit = Math.max(1, Math.min(Number(payload.limit || 5), 50));
  const { rows: signals } = await pg.query(
    `SELECT id, symbol, signal_side, signal_strength, entry_price, stop_loss, take_profit, reasoning
       FROM trading_signals
      WHERE agent_id = $1
        AND status = 'NEW'
      ORDER BY created_at ASC
      LIMIT $2`,
    [agentId, limit]
  );

  const out = [];

  for (const s of signals) {
    if (s.signal_side === "NONE") {
      await pg.query(`UPDATE trading_signals SET status='SKIPPED' WHERE id=$1`, [s.id]);
      continue;
    }

    const side = s.signal_side === "LONG" ? "BUY" : "SELL";
    const sizing = computePositionSize({
      equityUsd,
      price: Number(s.entry_price || 0),
      stopLoss: Number(s.stop_loss || 0),
      side,
      riskPct: cfg.risk_per_trade_pct,
      maxNotionalPct: cfg.max_position_notional_pct,
    });

    if (!(sizing.qty > 0)) {
      await pg.query(`UPDATE trading_signals SET status='SKIPPED' WHERE id=$1`, [s.id]);
      out.push({ signal_id: s.id, symbol: s.symbol, status: "SKIPPED", reason: "position size resolved to zero" });
      continue;
    }

    if (mode === "live" && !payload.confirm_live) {
      const ins = await pg.query(
        `INSERT INTO trading_orders
          (agent_id, signal_id, symbol, side, mode, status, qty, entry_price, stop_loss, take_profit, notional_usd, risk_usd, reasoning, provider, metadata)
         VALUES
          ($1,$2,$3,$4,$5,'PENDING_CONFIRMATION',$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         RETURNING id, status`,
        [
          agentId,
          s.id,
          s.symbol,
          side,
          mode,
          sizing.qty,
          s.entry_price,
          s.stop_loss,
          s.take_profit,
          sizing.notionalUsd,
          sizing.riskUsd,
          s.reasoning,
          "openalgo",
          JSON.stringify({ signal_strength: Number(s.signal_strength || 0), requires_confirmation: true }),
        ]
      );

      await pg.query(`UPDATE trading_signals SET status='ACTIONED', actioned_at=NOW() WHERE id=$1`, [s.id]);
      await logEvent({
        agent_id: agentId,
        severity: "warning",
        event_type: "live_order_confirmation_required",
        message: `${s.symbol} ${side} queued for live confirmation`,
        payload: { order_id: ins.rows[0].id, signal_id: s.id, notional_usd: sizing.notionalUsd },
      });

      out.push({ signal_id: s.id, order_id: ins.rows[0].id, status: "PENDING_CONFIRMATION", mode });
      continue;
    }

    let exchangeOrderId = null;
    let status = mode === "paper" ? "FILLED" : "OPEN";
    let provider = mode === "paper" ? "paper" : "openalgo";
    let metadata = { signal_strength: Number(s.signal_strength || 0) };

    if (mode === "live") {
      const live = await placeOpenAlgoOrder({
        symbol: s.symbol,
        side,
        qty: sizing.qty,
        mode: "live",
        stop_loss: s.stop_loss,
        take_profit: s.take_profit,
        metadata: { signal_id: s.id, agent_id: agentId },
      });

      if (!live.ok) {
        status = "REJECTED";
        metadata = { ...metadata, live_error: live.error, live_raw: live.raw || null };
        await logEvent({
          agent_id: agentId,
          severity: "warning",
          event_type: "order_rejected",
          message: `${s.symbol} ${side} order rejected: ${live.error}`,
          payload: { signal_id: s.id, symbol: s.symbol, side, error: live.error },
        });
      } else {
        exchangeOrderId = live.order_id;
        status = "OPEN";
        metadata = { ...metadata, live_raw: live.raw || null };
      }
    }

    const ins = await pg.query(
      `INSERT INTO trading_orders
         (agent_id, signal_id, symbol, side, mode, status, qty, entry_price, stop_loss, take_profit, notional_usd, risk_usd, reasoning, exchange_order_id, provider, metadata)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       RETURNING id, status, mode`,
      [
        agentId,
        s.id,
        s.symbol,
        side,
        mode,
        status,
        sizing.qty,
        s.entry_price,
        s.stop_loss,
        s.take_profit,
        sizing.notionalUsd,
        sizing.riskUsd,
        s.reasoning,
        exchangeOrderId,
        provider,
        JSON.stringify(metadata),
      ]
    );

    await pg.query(`UPDATE trading_signals SET status='ACTIONED', actioned_at=NOW() WHERE id=$1`, [s.id]);

    out.push({
      signal_id: s.id,
      order_id: ins.rows[0].id,
      status: ins.rows[0].status,
      mode: ins.rows[0].mode,
      symbol: s.symbol,
      side,
      qty: sizing.qty,
      notional_usd: sizing.notionalUsd,
      risk_usd: sizing.riskUsd,
      exchange_order_id: exchangeOrderId,
    });
  }

  return {
    ok: true,
    agent_id: agentId,
    mode,
    account_equity_usd: equityUsd,
    risk_gate: riskGate,
    processed: out.length,
    orders: out,
  };
}

async function closeOrder(payload = {}) {
  await ensureSchema();
  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const orderId = String(payload.order_id || "");
  const exitPrice = Number(payload.exit_price || 0);

  if (!orderId || !(exitPrice > 0)) {
    throw new Error("closeOrder requires { order_id, exit_price }");
  }

  const { rows } = await pg.query(
    `SELECT id, side, qty, entry_price, status, symbol
       FROM trading_orders
      WHERE id = $1
        AND agent_id = $2
      LIMIT 1`,
    [orderId, agentId]
  );

  const o = rows[0];
  if (!o) throw new Error(`order not found: ${orderId}`);
  if (!["OPEN", "FILLED"].includes(String(o.status))) {
    return { ok: true, skipped: true, reason: `order status ${o.status} not closeable`, order_id: orderId };
  }

  const qty = Number(o.qty || 0);
  const entry = Number(o.entry_price || 0);
  const side = String(o.side || "BUY");
  const pnl = side === "BUY" ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;

  await pg.query(
    `UPDATE trading_orders
        SET status = 'CLOSED',
            exit_price = $2,
            closed_at = NOW(),
            pnl_usd = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [orderId, exitPrice, round(pnl, 8)]
  );

  await logEvent({
    agent_id: agentId,
    severity: pnl >= 0 ? "info" : "warning",
    event_type: "order_closed",
    message: `${o.symbol} order ${orderId.slice(0, 8)} closed with PnL ${round(pnl, 2)} USD`,
    payload: { order_id: orderId, symbol: o.symbol, pnl_usd: round(pnl, 8), exit_price: exitPrice },
  });

  return {
    ok: true,
    order_id: orderId,
    symbol: o.symbol,
    exit_price: exitPrice,
    pnl_usd: round(pnl, 8),
  };
}

async function buildDailySummary(payload = {}) {
  await ensureSchema();

  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const metricDate = toDateISO(payload.metric_date || new Date());
  const cfg = await loadAgentConfig(agentId);

  const { rows } = await pg.query(
    `SELECT
        COUNT(*)::int AS trades_total,
        COUNT(*) FILTER (WHERE status='CLOSED')::int AS trades_closed,
        COUNT(*) FILTER (WHERE status='CLOSED' AND COALESCE(pnl_usd,0) > 0)::int AS wins,
        COUNT(*) FILTER (WHERE status='CLOSED' AND COALESCE(pnl_usd,0) < 0)::int AS losses,
        COALESCE(SUM(CASE WHEN status='CLOSED' THEN COALESCE(pnl_usd,0) ELSE 0 END),0)::numeric AS realized_pnl_usd
      FROM trading_orders
     WHERE agent_id = $1
       AND opened_at::date = $2::date`,
    [agentId, metricDate]
  );

  const stats = rows[0] || {};
  const tradesClosed = Number(stats.trades_closed || 0);
  const wins = Number(stats.wins || 0);
  const winRate = tradesClosed > 0 ? (wins / tradesClosed) * 100 : 0;
  const maxDrawdownPct = await computeMaxDrawdownPct(agentId, 90);

  const { rows: alertRows } = await pg.query(
    `SELECT COUNT(*)::int AS alerts_count
       FROM trading_events
      WHERE agent_id = $1
        AND created_at::date = $2::date
        AND severity IN ('warning','critical')`,
    [agentId, metricDate]
  );
  const alertsCount = Number(alertRows[0]?.alerts_count || 0);

  await pg.query(
    `INSERT INTO trading_daily_metrics
      (metric_date, agent_id, mode, trades_total, trades_closed, wins, losses, win_rate, realized_pnl_usd, max_drawdown_pct, alerts_count, updated_at)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (metric_date, agent_id)
     DO UPDATE SET
       mode = EXCLUDED.mode,
       trades_total = EXCLUDED.trades_total,
       trades_closed = EXCLUDED.trades_closed,
       wins = EXCLUDED.wins,
       losses = EXCLUDED.losses,
       win_rate = EXCLUDED.win_rate,
       realized_pnl_usd = EXCLUDED.realized_pnl_usd,
       max_drawdown_pct = EXCLUDED.max_drawdown_pct,
       alerts_count = EXCLUDED.alerts_count,
       updated_at = NOW()`,
    [
      metricDate,
      agentId,
      cfg.mode,
      Number(stats.trades_total || 0),
      tradesClosed,
      wins,
      Number(stats.losses || 0),
      round(winRate, 4),
      Number(stats.realized_pnl_usd || 0),
      round(maxDrawdownPct, 4),
      alertsCount,
    ]
  );

  const summary = {
    ok: true,
    metric_date: metricDate,
    agent_id: agentId,
    mode: cfg.mode,
    is_paused: cfg.is_paused,
    pause_reason: cfg.pause_reason,
    trades_total: Number(stats.trades_total || 0),
    trades_closed: tradesClosed,
    wins,
    losses: Number(stats.losses || 0),
    win_rate_pct: round(winRate, 4),
    realized_pnl_usd: round(Number(stats.realized_pnl_usd || 0), 8),
    max_drawdown_pct: round(maxDrawdownPct, 4),
    alerts_count: alertsCount,
  };

  ensureDir(REPORT_DIR);
  const stamp = `${metricDate}-${agentId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const reportPath = path.join(REPORT_DIR, `${stamp}-trading-daily-summary.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  if (envBool("QUANT_DAILY_SUMMARY_NOTIFY", true)) {
    await notifyMonitoring(
      [
        "📊 *QuantFusion Daily Trading Summary*",
        `date: \`${metricDate}\``,
        `agent: \`${agentId}\` (${cfg.mode}${cfg.is_paused ? ", paused" : ""})`,
        `trades: ${summary.trades_total} total / ${summary.trades_closed} closed`,
        `win rate: ${summary.win_rate_pct}%`,
        `realized pnl: ${summary.realized_pnl_usd} USD`,
        `max drawdown (90d): ${summary.max_drawdown_pct}%`,
        `alerts: ${alertsCount}`,
      ].join("\n")
    ).catch(() => {});
  }

  return {
    ...summary,
    report_path: reportPath,
  };
}

async function runBacktest(payload = {}) {
  await ensureSchema();
  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const candles = Array.isArray(payload.candles) ? payload.candles : [];
  const symbol = String(payload.symbol || payload.market?.symbol || "UNKNOWN").toUpperCase();
  const timeframe = String(payload.timeframe || "15m");

  let trades = [];

  if (candles.length >= 30) {
    for (let i = 20; i < candles.length - 1; i += 1) {
      const c = candles[i] || {};
      const next = candles[i + 1] || {};
      const snap = normalizeSnapshot({
        symbol,
        timeframe,
        price: Number(c.close || c.price || 0),
        ema_fast: Number(c.ema_fast || c.ema20 || c.close || 0),
        ema_slow: Number(c.ema_slow || c.ema50 || c.close || 0),
        rsi: Number(c.rsi || 50),
        atr: Number(c.atr || Math.abs(Number(c.high || 0) - Number(c.low || 0))),
        day_high: Number(c.high || c.day_high || c.close || 0),
        day_low: Number(c.low || c.day_low || c.close || 0),
      });
      const sig = deriveSignal(snap);
      if (sig.side === "NONE") continue;

      const entry = Number(snap.price || 0);
      const stop = Number(sig.stop || 0);
      const tp = Number(sig.takeProfit || 0);
      const high = Number(next.high || next.close || entry);
      const low = Number(next.low || next.close || entry);
      const close = Number(next.close || entry);

      let exit = close;
      if (sig.side === "LONG") {
        if (low <= stop) exit = stop;
        else if (high >= tp) exit = tp;
      } else {
        if (high >= stop) exit = stop;
        else if (low <= tp) exit = tp;
      }

      const pnl = sig.side === "LONG" ? (exit - entry) : (entry - exit);
      trades.push({
        at: c.timestamp || c.time || null,
        side: sig.side,
        entry,
        stop,
        take_profit: tp,
        exit,
        pnl,
      });
    }
  } else {
    const { rows } = await pg.query(
      `SELECT side, entry_price, exit_price, pnl_usd, opened_at, closed_at
         FROM trading_orders
        WHERE agent_id = $1
          AND status = 'CLOSED'
        ORDER BY closed_at DESC
        LIMIT 500`,
      [agentId]
    );
    trades = rows.map((r) => ({
      at: r.closed_at || r.opened_at,
      side: r.side,
      entry: Number(r.entry_price || 0),
      exit: Number(r.exit_price || 0),
      pnl: Number(r.pnl_usd || 0),
    }));
  }

  const total = trades.length;
  const wins = trades.filter((t) => Number(t.pnl) > 0).length;
  const losses = trades.filter((t) => Number(t.pnl) < 0).length;
  const netPnl = trades.reduce((a, t) => a + Number(t.pnl || 0), 0);
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity += Number(t.pnl || 0);
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }

  const summary = {
    ok: true,
    agent_id: agentId,
    symbol,
    timeframe,
    candles_used: candles.length,
    trades: total,
    wins,
    losses,
    win_rate_pct: round(winRate, 4),
    net_pnl_points: round(netPnl, 8),
    max_drawdown_pct: round(maxDrawdown, 4),
    notes: candles.length < 30
      ? "Used historical closed orders because candles were not provided."
      : "Backtest executed on provided candles.",
  };

  ensureDir(REPORT_DIR);
  const stamp = `${new Date().toISOString().slice(0, 10)}-${agentId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const reportPath = path.join(REPORT_DIR, `${stamp}-trading-backtest.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ summary, sample_trades: trades.slice(0, 120) }, null, 2));

  await logEvent({
    agent_id: agentId,
    severity: summary.net_pnl_points < 0 ? "warning" : "info",
    event_type: "strategy_backtest",
    message: `Backtest complete: trades=${summary.trades}, win_rate=${summary.win_rate_pct}%, net=${summary.net_pnl_points}`,
    payload: { report_path: reportPath, ...summary },
  });

  return { ...summary, report_path: reportPath };
}

async function pauseAgent(payload = {}) {
  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const reason = String(payload.reason || "manual pause");
  const cfg = await updateAgentConfig(agentId, {
    is_paused: true,
    pause_reason: reason,
  });

  await logEvent({
    agent_id: agentId,
    severity: "warning",
    event_type: "agent_paused",
    message: `Agent paused: ${reason}`,
    payload: { reason, actor: payload.actor || "system" },
  });

  return { ok: true, agent_id: agentId, is_paused: cfg.is_paused, pause_reason: cfg.pause_reason };
}

async function resumeAgent(payload = {}) {
  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const cfg = await updateAgentConfig(agentId, {
    is_paused: false,
    pause_reason: null,
  });

  await logEvent({
    agent_id: agentId,
    severity: "info",
    event_type: "agent_resumed",
    message: "Agent resumed",
    payload: { actor: payload.actor || "system" },
  });

  return { ok: true, agent_id: agentId, is_paused: cfg.is_paused };
}

async function getTradingStatus(payload = {}) {
  await ensureSchema();
  const agentId = String(payload.agent_id || AGENT_ID_DEFAULT);
  const cfg = await loadAgentConfig(agentId);

  const [openOrders, pendingSignals, dayMetrics] = await Promise.all([
    pg.query(`SELECT COUNT(*)::int AS n FROM trading_orders WHERE agent_id=$1 AND status IN ('OPEN','FILLED','PENDING_CONFIRMATION')`, [agentId]),
    pg.query(`SELECT COUNT(*)::int AS n FROM trading_signals WHERE agent_id=$1 AND status='NEW'`, [agentId]),
    pg.query(`SELECT * FROM trading_daily_metrics WHERE agent_id=$1 ORDER BY metric_date DESC LIMIT 1`, [agentId]),
  ]);

  return {
    ok: true,
    as_of: nowIso(),
    agent_id: agentId,
    config: cfg,
    open_orders: Number(openOrders.rows[0]?.n || 0),
    pending_signals: Number(pendingSignals.rows[0]?.n || 0),
    latest_metrics: dayMetrics.rows[0] || null,
  };
}

module.exports = {
  AGENT_ID_DEFAULT,
  ensureSchema,
  loadAgentConfig,
  updateAgentConfig,
  runSignalScan,
  executeOrders,
  closeOrder,
  runBacktest,
  buildDailySummary,
  pauseAgent,
  resumeAgent,
  getTradingStatus,
};

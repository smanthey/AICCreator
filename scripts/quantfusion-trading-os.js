#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const {
  runSignalScan,
  executeOrders,
  closeOrder,
  buildDailySummary,
  pauseAgent,
  resumeAgent,
  updateAgentConfig,
  getTradingStatus,
} = require("../control/quantfusion-trading-ops");

const args = process.argv.slice(2);
const cmd = String(args[0] || "status").toLowerCase();

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function has(flag) {
  return args.includes(flag);
}

function parseSymbols(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

(async () => {
  try {
    const agentId = String(arg("--agent", "quantfusion-core"));

    if (cmd === "status") {
      console.log(JSON.stringify(await getTradingStatus({ agent_id: agentId }), null, 2));
      return;
    }

    if (cmd === "signal:scan" || cmd === "strategy:run") {
      const out = await runSignalScan({
        agent_id: agentId,
        symbols: parseSymbols(arg("--symbols", process.env.QUANT_SYMBOLS || "SPY,QQQ,BTCUSD")),
        timeframe: arg("--timeframe", process.env.QUANT_TIMEFRAME || "15m"),
        market: {
          symbol: arg("--symbol", ""),
          price: arg("--price", undefined),
          ema_fast: arg("--ema-fast", undefined),
          ema_slow: arg("--ema-slow", undefined),
          rsi: arg("--rsi", undefined),
          atr: arg("--atr", undefined),
          day_high: arg("--day-high", undefined),
          day_low: arg("--day-low", undefined),
        },
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "execute") {
      const out = await executeOrders({
        agent_id: agentId,
        mode: arg("--mode", process.env.QUANT_MODE || "paper"),
        confirm_live: has("--confirm-live"),
        limit: Number(arg("--limit", "5")) || 5,
        account_equity_usd: Number(arg("--equity", process.env.QUANT_EQUITY_USD || "10000")) || 10000,
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "close") {
      const orderId = arg("--order-id", "");
      const exitPrice = Number(arg("--exit", "0")) || 0;
      const out = await closeOrder({ agent_id: agentId, order_id: orderId, exit_price: exitPrice });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "summary") {
      const out = await buildDailySummary({
        agent_id: agentId,
        metric_date: arg("--date", undefined),
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "pause") {
      const out = await pauseAgent({
        agent_id: agentId,
        reason: arg("--reason", "manual pause"),
        actor: arg("--actor", "cli"),
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "resume") {
      const out = await resumeAgent({
        agent_id: agentId,
        actor: arg("--actor", "cli"),
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "config") {
      const payload = {
        agent_id: agentId,
        mode: arg("--mode", undefined),
        risk_per_trade_pct: arg("--risk-pct", undefined),
        max_position_notional_pct: arg("--max-notional-pct", undefined),
        daily_loss_limit_pct: arg("--daily-loss-pct", undefined),
        max_drawdown_pct: arg("--max-dd-pct", undefined),
        allowed_symbols: parseSymbols(arg("--symbols", undefined)),
      };
      const out = await updateAgentConfig(agentId, payload);
      console.log(JSON.stringify({ ok: true, config: out }, null, 2));
      return;
    }

    console.log(`QuantFusion Trading OS\n\nCommands:\n  status [--agent quantfusion-core]\n  signal:scan [--agent id] [--symbols SPY,QQQ,BTCUSD] [--timeframe 15m]\n  strategy:run [same as signal:scan]\n  execute [--agent id] [--mode paper|live] [--confirm-live] [--equity 10000] [--limit 5]\n  close --order-id <uuid> --exit <price> [--agent id]\n  summary [--agent id] [--date YYYY-MM-DD]\n  pause [--agent id] [--reason text]\n  resume [--agent id]\n  config [--agent id] [--mode paper|live] [--risk-pct 1] [--max-notional-pct 10] [--daily-loss-pct 3] [--max-dd-pct 8] [--symbols SPY,QQQ]`);
  } catch (err) {
    console.error("[quantfusion-trading-os] fatal:", err.message || String(err));
    process.exit(1);
  }
})();

"use strict";

const { register } = require("./registry");
const {
  ensureSchema,
  runSignalScan,
  executeOrders,
  closeOrder,
  runBacktest,
  buildDailySummary,
  pauseAgent,
  resumeAgent,
  updateAgentConfig,
  getTradingStatus,
} = require("../control/quantfusion-trading-ops");

register("quant_trading_signal_scan", async (payload = {}) => {
  await ensureSchema();
  return runSignalScan(payload);
});

register("quant_trading_strategy_run", async (payload = {}) => {
  await ensureSchema();
  return runSignalScan(payload);
});

register("quant_trading_execute_orders", async (payload = {}) => {
  await ensureSchema();
  return executeOrders(payload);
});

register("quant_trading_close_order", async (payload = {}) => {
  await ensureSchema();
  return closeOrder(payload);
});

register("quant_trading_daily_summary", async (payload = {}) => {
  await ensureSchema();
  return buildDailySummary(payload);
});

register("quant_trading_backtest", async (payload = {}) => {
  await ensureSchema();
  return runBacktest(payload);
});

register("quant_trading_pause", async (payload = {}) => {
  await ensureSchema();
  return pauseAgent(payload);
});

register("quant_trading_resume", async (payload = {}) => {
  await ensureSchema();
  return resumeAgent(payload);
});

register("quant_trading_config_update", async (payload = {}) => {
  await ensureSchema();
  const agentId = String(payload.agent_id || "quantfusion-core");
  const cfg = await updateAgentConfig(agentId, payload);
  return { ok: true, agent_id: agentId, config: cfg };
});

register("quant_trading_status", async (payload = {}) => {
  await ensureSchema();
  return getTradingStatus(payload);
});

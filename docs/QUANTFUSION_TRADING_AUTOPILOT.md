# QuantFusion Trading Autopilot (Paper-First)

## What was added

Core components:
- `control/quantfusion-trading-ops.js`
- `agents/quantfusion-trading-agent.js`
- `scripts/quantfusion-trading-os.js`
- `scripts/quantfusion-trading-queue.js`
- `scripts/quantfusion-overnight-algo-dev.js`
- `migrations/072_quantfusion_trading_core.sql`

Task types:
- `quant_trading_signal_scan`
- `quant_trading_strategy_run`
- `quant_trading_execute_orders`
- `quant_trading_close_order`
- `quant_trading_backtest`
- `quant_trading_daily_summary`
- `quant_trading_pause`
- `quant_trading_resume`
- `quant_trading_config_update`
- `quant_trading_status`

## Safety controls

- Default mode: `paper`
- Live mode requires explicit confirmation (`confirm_live=true`) for execution queue payloads
- Risk gates:
  - per-trade risk cap
  - max position notional cap
  - daily loss limit
  - max drawdown pause
- Full event logging and daily summary artifacts

## Overnight algo-dev workflow

`claw-quantfusion-overnight-algo-dev` runs daily at **4:15 AM**:
1. Review daily performance (`quant_trading_daily_summary`)
2. Backtest edge-cases (`quant_trading_backtest`)
3. Propose strategy updates (`quant_trading_signal_scan`)
4. Validate in paper mode (`quant_trading_execute_orders` with mode=paper)
5. Queue OpenCode implementation pass for `quantfusion` (`opencode_controller`)

## Commands

- Status: `npm run quantfusion:trading:status`
- Paper cycle queue: `npm run quantfusion:trading:paper-cycle`
- Manual execute: `npm run quantfusion:trading -- execute --mode paper`
- Daily summary: `npm run quantfusion:trading:daily`
- Overnight queue now: `npm run quantfusion:trading:overnight -- --mode paper`
- Pause: `npm run quantfusion:trading -- pause --reason "manual"`
- Resume: `npm run quantfusion:trading -- resume`

## Notes

- OpenAlgo integration is used when `OPENALGO_BASE_URL` is set.
- Without OpenAlgo endpoint, paper mode still runs fully and logs to DB.
- Generated reports are under `scripts/reports/`.

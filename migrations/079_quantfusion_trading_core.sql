-- 079_quantfusion_trading_core.sql
-- QuantFusion autonomous trading spine: signals, orders, risk config, events, daily metrics.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trading_agent_config (
  agent_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  pause_reason TEXT,
  risk_per_trade_pct NUMERIC(8,4) NOT NULL DEFAULT 1.0,
  max_position_notional_pct NUMERIC(8,4) NOT NULL DEFAULT 10.0,
  daily_loss_limit_pct NUMERIC(8,4) NOT NULL DEFAULT 3.0,
  max_drawdown_pct NUMERIC(8,4) NOT NULL DEFAULT 8.0,
  allowed_symbols TEXT[] NOT NULL DEFAULT '{}'::text[],
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trading_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT,
  signal_side TEXT NOT NULL CHECK (signal_side IN ('LONG','SHORT','NONE')),
  signal_strength NUMERIC(8,4),
  entry_price NUMERIC(18,8),
  stop_loss NUMERIC(18,8),
  take_profit NUMERIC(18,8),
  reasoning TEXT,
  market_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','SKIPPED','ACTIONED','EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actioned_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trading_signals_agent_created
  ON trading_signals(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_signals_symbol_created
  ON trading_signals(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS trading_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  signal_id UUID REFERENCES trading_signals(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  mode TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('PENDING_CONFIRMATION','OPEN','FILLED','CLOSED','CANCELLED','REJECTED')),
  qty NUMERIC(18,8) NOT NULL,
  entry_price NUMERIC(18,8),
  exit_price NUMERIC(18,8),
  stop_loss NUMERIC(18,8),
  take_profit NUMERIC(18,8),
  notional_usd NUMERIC(18,8),
  risk_usd NUMERIC(18,8),
  reasoning TEXT,
  exchange_order_id TEXT,
  provider TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  pnl_usd NUMERIC(18,8),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_orders_agent_status_created
  ON trading_orders(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_orders_symbol_created
  ON trading_orders(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS trading_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_events_agent_created
  ON trading_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_events_severity_created
  ON trading_events(severity, created_at DESC);

CREATE TABLE IF NOT EXISTS trading_daily_metrics (
  metric_date DATE NOT NULL,
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'paper',
  trades_total INT NOT NULL DEFAULT 0,
  trades_closed INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  win_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  realized_pnl_usd NUMERIC(18,8) NOT NULL DEFAULT 0,
  max_drawdown_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  alerts_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(metric_date, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_trading_daily_metrics_agent_date
  ON trading_daily_metrics(agent_id, metric_date DESC);

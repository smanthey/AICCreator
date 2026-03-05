-- 083_trading_audit_fields.sql
-- Add audit metadata and clarify foreign key behavior for QuantFusion trading tables.
-- This migration is idempotent and safe to run multiple times.

-- trading_signals: track who/what created and last updated a signal,
-- and optionally where it came from (e.g. "quantfusion_algo_dev", "manual_override").
ALTER TABLE IF EXISTS trading_signals
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

-- trading_orders: track who/what created and last updated an order.
ALTER TABLE IF EXISTS trading_orders
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- trading_events: optional correlation_id to stitch together a sequence of related events
-- (for example, a signal → orders → risk alerts chain).
ALTER TABLE IF EXISTS trading_events
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

-- FK consistency notes: document intended behavior without changing existing semantics.
COMMENT ON COLUMN trading_orders.signal_id IS
  'FK to trading_signals.id; ON DELETE SET NULL to preserve order history even if signals are pruned.';

COMMENT ON COLUMN trading_signals.agent_id IS
  'Logical FK to trading_agent_config.agent_id; enforced at application level to allow lightweight configs.';


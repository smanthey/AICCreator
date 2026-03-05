-- Add routing telemetry for model-router Claw 2.0 matrix enforcement.

ALTER TABLE IF EXISTS model_usage
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS routing_outcome TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_model_usage_routing_outcome ON model_usage (routing_outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_escalation_reason ON model_usage (escalation_reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_cache_hit ON model_usage (cache_hit, created_at DESC);

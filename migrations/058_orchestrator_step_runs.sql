-- Migration 058: Backlog orchestrator run ledger
-- Dedicated table for periodic orchestration step execution history.

CREATE TABLE IF NOT EXISTS orchestrator_step_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_name     TEXT NOT NULL,
  runner        TEXT NOT NULL DEFAULT 'backlog_orchestrator',
  status        TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED', 'SKIPPED')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  duration_ms   INTEGER,
  reason        TEXT,
  result_json   JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_step_runs_step_time
  ON orchestrator_step_runs(step_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_step_runs_runner_time
  ON orchestrator_step_runs(runner, started_at DESC);


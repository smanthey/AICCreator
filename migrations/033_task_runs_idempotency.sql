-- Migration 033: Task idempotency and run ledger
-- Provides retry/crash-safe duplicate suppression.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_idempotency_key
  ON tasks (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID REFERENCES tasks(id) ON DELETE SET NULL,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'RUNNING'
                   CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  worker_id        TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  result           JSONB,
  error            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_runs_idempotency_key
  ON task_runs (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id
  ON task_runs (task_id);

CREATE INDEX IF NOT EXISTS idx_task_runs_status_started
  ON task_runs (status, started_at DESC);

-- Migration 034: workflow run ids, lock ownership/heartbeat, and task quarantine

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_run_id
  ON tasks (workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS exclusive_locks (
  lock_key       TEXT PRIMARY KEY,
  lock_token     TEXT NOT NULL,
  task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
  worker_id      TEXT,
  ttl_seconds    INTEGER NOT NULL DEFAULT 900,
  acquired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_exclusive_locks_expires_at
  ON exclusive_locks (expires_at);

CREATE TABLE IF NOT EXISTS task_quarantine (
  task_id        UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  reason         TEXT NOT NULL,
  source         TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_task_quarantine_active
  ON task_quarantine (active)
  WHERE active = TRUE;

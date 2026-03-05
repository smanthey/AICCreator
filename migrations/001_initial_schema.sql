-- migrations/001_initial_schema.sql
-- Creates the core tasks table with all base columns.
-- Safe to re-run (IF NOT EXISTS throughout).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'CREATED'
                           CHECK (status IN (
                             'CREATED','PENDING','QUEUED','DISPATCHED',
                             'RUNNING','COMPLETED','FAILED','RETRY',
                             'DEAD_LETTER','VERIFIED','DELIVERED',
                             'SKIPPED','CANCELLED'
                           )),
  priority     INTEGER     NOT NULL DEFAULT 3,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on any change
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_tasks_status_created
  ON tasks(status, created_at ASC);

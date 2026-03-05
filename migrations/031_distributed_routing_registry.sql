-- Migration 031: distributed routing + device registry

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_tasks_required_tags
  ON tasks USING GIN(required_tags);

-- Canonical device registry for scheduler/routing decisions.
CREATE TABLE IF NOT EXISTS device_registry (
  worker_id            TEXT PRIMARY KEY,
  hostname             TEXT,
  tags                 TEXT[]      DEFAULT '{}',
  status               TEXT        NOT NULL DEFAULT 'ready', -- ready|busy|draining|offline
  ram_gb               INTEGER,
  cpu_cores            INTEGER,
  always_on            BOOLEAN     DEFAULT false,
  current_jobs_count   INTEGER     DEFAULT 0,
  last_heartbeat       TIMESTAMPTZ DEFAULT NOW(),
  capabilities         JSONB       DEFAULT '{}',
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_registry_status ON device_registry(status, last_heartbeat DESC);
CREATE INDEX IF NOT EXISTS idx_device_registry_tags   ON device_registry USING GIN(tags);

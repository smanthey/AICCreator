-- migrations/007_workers_and_queues.sql
-- Run: psql -U claw -d claw_architect -f migrations/007_workers_and_queues.sql
--
-- Adds: worker heartbeat table + worker_queue routing column on tasks

-- ═══════════════════════════════════════════════════════════════
-- WORKER HEARTBEATS
-- Each running worker upserts this row every 10s.
-- Dispatcher can skip unhealthy workers.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workers (
  worker_id         TEXT        PRIMARY KEY,
  hostname          TEXT,
  tags              TEXT[]      DEFAULT '{}',
  node_role         TEXT        DEFAULT 'worker',
  last_seen         TIMESTAMPTZ DEFAULT NOW(),
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  load_avg          NUMERIC(4,2),
  free_ram_mb       INTEGER,
  tasks_completed   INTEGER     DEFAULT 0,
  tasks_failed      INTEGER     DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workers_last_seen ON workers(last_seen DESC);

-- ═══════════════════════════════════════════════════════════════
-- WORKER QUEUE ROUTING
-- Each task can specify which queue it belongs to.
-- Defaults to 'claw_tasks' (the control-plane queue).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS worker_queue TEXT DEFAULT 'claw_tasks';

CREATE INDEX IF NOT EXISTS idx_tasks_worker_queue
  ON tasks(worker_queue, status, priority DESC, created_at ASC)
  WHERE status = 'CREATED';

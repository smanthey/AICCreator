-- migrations/005_task_chaining_and_retry.sql
-- Run: psql -U claw -d clawdb -f migrations/005_task_chaining_and_retry.sql
--
-- Adds: task chaining, retry logic, dead letter tracking, plans table
-- Non-destructive: all columns are additive, nothing existing changes

-- ═══════════════════════════════════════════════════════════════
-- TASK CHAINING
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on UUID[] DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depth INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';

-- ═══════════════════════════════════════════════════════════════
-- RETRY + DEAD LETTER
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS backoff_ms INTEGER DEFAULT 5000;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;

-- ═══════════════════════════════════════════════════════════════
-- COST + MODEL TRACKING
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,4) DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS model_used TEXT;

-- ═══════════════════════════════════════════════════════════════
-- PLANS TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal TEXT NOT NULL,
  raw_plan JSONB,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  estimated_cost_usd NUMERIC(10,4),
  actual_cost_usd NUMERIC(10,4) DEFAULT 0,
  model_used TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_depends ON tasks USING GIN(depends_on);
CREATE INDEX IF NOT EXISTS idx_tasks_retry ON tasks(next_retry_at) WHERE status = 'RETRY';
CREATE INDEX IF NOT EXISTS idx_tasks_queued ON tasks(priority DESC, created_at ASC) WHERE status = 'CREATED';
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ═══════════════════════════════════════════════════════════════
-- ADD NEW VALID STATUSES
-- (Your task.js already has RETRY, DEAD_LETTER — we also need
--  PENDING and SKIPPED for chaining)
-- ═══════════════════════════════════════════════════════════════
-- No SQL needed — we update task.js in code

-- migrations/006_audit_log_approvals_hardening.sql
-- Run: psql -U claw -d clawdb -f migrations/006_audit_log_approvals_hardening.sql
--
-- Adds: audit_log, plan_approvals, task timeout + started/completed timestamps
-- Non-destructive: all additive

-- ═══════════════════════════════════════════════════════════════
-- TASK TIMESTAMPS + TIMEOUT
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timeout_seconds INTEGER DEFAULT 300;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════════
-- AUDIT LOG (append-only black box)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID,
  plan_id     UUID,
  from_status TEXT,
  to_status   TEXT,
  event       TEXT,
  error       TEXT,
  worker_id   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- NO DELETE POLICY: never delete from this table
-- Grant insert-only in production: REVOKE DELETE ON audit_log FROM claw;

CREATE INDEX IF NOT EXISTS idx_audit_task    ON audit_log(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_plan    ON audit_log(plan_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- PLAN APPROVALS (stateful approval gate)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plan_approvals (
  plan_id           UUID        PRIMARY KEY,
  telegram_user_id  TEXT,
  telegram_chat_id  TEXT,
  approval_token    TEXT        NOT NULL,
  approved          BOOLEAN     DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 hours',
  approved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approvals_token ON plan_approvals(approval_token);

-- ═══════════════════════════════════════════════════════════════
-- METRICS INDEXES (for fast dashboard queries)
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_tasks_completed_at
  ON tasks(completed_at DESC) WHERE status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_tasks_dead_letter
  ON tasks(dead_lettered_at DESC) WHERE status = 'DEAD_LETTER';

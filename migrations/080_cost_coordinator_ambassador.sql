-- migrations/080_cost_coordinator_ambassador.sql
-- Adds tables for Cost Coordinator and Ambassador Agent

-- ── cost_coordinator_blocks ───────────────────────────────────────
-- Tracks budget requests that were blocked by the cost coordinator
-- Used for monitoring and alerting

CREATE TABLE IF NOT EXISTS cost_coordinator_blocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT now(),
  
  model_id    TEXT        NOT NULL,              -- Model that was requested
  provider    TEXT        NOT NULL,              -- Provider (openai, anthropic, etc.)
  estimated_cost NUMERIC(12,8) NOT NULL,        -- Estimated cost that was blocked
  reason      TEXT        NOT NULL,              -- Why it was blocked (daily_cap_exceeded, provider_cap_exceeded)
  agent_id    TEXT,                              -- Agent that made the request
  task_type   TEXT,                              -- Task type for analysis
  
  -- Additional context
  metadata    JSONB       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cost_blocks_created ON cost_coordinator_blocks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_blocks_reason ON cost_coordinator_blocks (reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_blocks_agent ON cost_coordinator_blocks (agent_id, created_at DESC) WHERE agent_id IS NOT NULL;

-- ── ambassador_messages ───────────────────────────────────────────
-- Tracks messages sent by the Ambassador Agent
-- Used for deduplication and history

CREATE TABLE IF NOT EXISTS ambassador_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT now(),
  
  issue_key   TEXT        NOT NULL,              -- Unique key for deduplication
  issue_type  TEXT        NOT NULL,              -- service_health, conflict, budget, etc.
  priority    TEXT        NOT NULL,              -- high, medium, low
  message     TEXT        NOT NULL,              -- The formatted message sent
  sent_to     TEXT[],                            -- Channels sent to (telegram, discord, slack)
  
  -- Resolution tracking
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                             -- Human or agent that resolved
  resolution  TEXT,                              -- How it was resolved
  
  metadata    JSONB       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ambassador_issue_key ON ambassador_messages (issue_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ambassador_type ON ambassador_messages (issue_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ambassador_priority ON ambassador_messages (priority, created_at DESC) WHERE priority = 'high';
CREATE INDEX IF NOT EXISTS idx_ambassador_resolved ON ambassador_messages (resolved_at) WHERE resolved_at IS NULL;

-- ── cost_coordinator_requests ────────────────────────────────────
-- Tracks all budget requests (approved and blocked) for analytics

CREATE TABLE IF NOT EXISTS cost_coordinator_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT now(),
  
  model_id    TEXT        NOT NULL,
  provider    TEXT        NOT NULL,
  estimated_tokens_in  INTEGER NOT NULL,
  estimated_tokens_out INTEGER NOT NULL,
  estimated_cost NUMERIC(12,8) NOT NULL,
  approved    BOOLEAN     NOT NULL,
  reason      TEXT,                              -- If not approved, why
  agent_id    TEXT,
  task_type   TEXT,
  
  -- Actual usage (filled in after execution)
  actual_tokens_in  INTEGER,
  actual_tokens_out INTEGER,
  actual_cost       NUMERIC(12,8),
  
  metadata    JSONB       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cost_requests_created ON cost_coordinator_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_requests_approved ON cost_coordinator_requests (approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_requests_agent ON cost_coordinator_requests (agent_id, created_at DESC) WHERE agent_id IS NOT NULL;

-- migrations/015_model_usage_orchestrations.sql
-- Adds two tables:
--   model_usage       — tracks every LLM call cost + provider via model-router
--   orchestrations    — top-level orchestration records (goal → sub-goals → plans)

-- ── model_usage ───────────────────────────────────────────────
-- One row per LLM call routed through infra/model-router.js
-- Enables per-provider cost breakdown and subscription vs API savings tracking

CREATE TABLE IF NOT EXISTS model_usage (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL    DEFAULT now(),

  -- Routing context
  task_type   TEXT        NOT NULL,              -- e.g. "analyze_content", "plan", "triage"
  model_key   TEXT        NOT NULL,              -- e.g. "sub_haiku", "gemini_flash", "api_sonnet"
  provider    TEXT        NOT NULL,              -- "sub" | "gemini" | "deepseek" | "anthropic"
  model_id    TEXT        NOT NULL,              -- exact model string used

  -- Token counts (0 for subscription calls)
  tokens_in   INTEGER     NOT NULL DEFAULT 0,
  tokens_out  INTEGER     NOT NULL DEFAULT 0,

  -- Cost (0.000000 for subscription calls — tracks real savings)
  cost_usd    NUMERIC(12,8) NOT NULL DEFAULT 0,

  -- Lineage (optional — links call to a task/plan)
  task_id     UUID,
  plan_id     UUID
);

-- Indexes for cost analysis queries
CREATE INDEX IF NOT EXISTS idx_model_usage_created   ON model_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_provider  ON model_usage (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_task_type ON model_usage (task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_task_id   ON model_usage (task_id) WHERE task_id IS NOT NULL;

-- ── orchestrations ────────────────────────────────────────────
-- Top-level goal decomposition records from agents/orchestrator.js
-- Each row = one "orchestrate" task invocation

CREATE TABLE IF NOT EXISTS orchestrations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL    DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL    DEFAULT now(),

  -- The high-level goal Scott gave
  goal         TEXT        NOT NULL,

  -- LLM reasoning trace (from FIO decomposition)
  reasoning    TEXT,

  -- Sub-goals produced by the orchestrator (JSON array)
  sub_goals    JSONB,

  -- Dispatch results (JSON array — plan_ids, statuses)
  result       JSONB,

  -- Lifecycle
  status       TEXT        NOT NULL DEFAULT 'pending',
  -- pending | running | dispatched | partial | error | dry_run | fallback

  error_message TEXT,

  -- Cost of the orchestration LLM call itself
  cost_usd     NUMERIC(12,8) DEFAULT 0,
  model_used   TEXT,

  -- Lineage to parent plan (if orchestrate was triggered by a task)
  plan_id      UUID
);

CREATE INDEX IF NOT EXISTS idx_orchestrations_created ON orchestrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestrations_status  ON orchestrations (status);
CREATE INDEX IF NOT EXISTS idx_orchestrations_plan_id ON orchestrations (plan_id) WHERE plan_id IS NOT NULL;

-- ── Cost summary view ─────────────────────────────────────────
-- Quick view for /status command: daily spend by provider
CREATE OR REPLACE VIEW model_cost_summary AS
SELECT
  date_trunc('day', created_at)  AS day,
  provider,
  model_key,
  COUNT(*)                        AS calls,
  SUM(tokens_in)                  AS total_tokens_in,
  SUM(tokens_out)                 AS total_tokens_out,
  SUM(cost_usd)                   AS total_cost_usd,
  ROUND(
    100.0 * SUM(CASE WHEN provider = 'sub' THEN 1 ELSE 0 END) / COUNT(*), 1
  )                               AS sub_pct
FROM model_usage
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 6 DESC;

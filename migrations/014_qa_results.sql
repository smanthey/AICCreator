-- migrations/014_qa_results.sql
-- QA test run results — stores spec execution outcomes + screenshots.
--
-- Run on NAS Postgres:
--   psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -f migrations/014_qa_results.sql

CREATE TABLE IF NOT EXISTS qa_results (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Spec identity
  spec_name     TEXT        NOT NULL,              -- e.g. "forgot-password"
  spec_file     TEXT,                              -- path to the YAML spec
  target_url    TEXT        NOT NULL,

  -- Outcome
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','passed','failed','error')),
  error_message TEXT,
  page_title    TEXT,
  screenshot    TEXT,                              -- relative artifact path

  -- Steps trace (JSONB array of {action, selector, status, error})
  steps_trace   JSONB,

  -- Timing
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  duration_ms   INT,

  -- Lineage
  plan_id       UUID,
  task_id       UUID,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_results_spec  ON qa_results (spec_name);
CREATE INDEX IF NOT EXISTS idx_qa_results_status ON qa_results (status);
CREATE INDEX IF NOT EXISTS idx_qa_results_plan   ON qa_results (plan_id) WHERE plan_id IS NOT NULL;

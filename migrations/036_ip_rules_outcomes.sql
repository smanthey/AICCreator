-- Migration 036: deterministic rule versioning + outcome tracking

CREATE TABLE IF NOT EXISTS ip_rule_sets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version           INTEGER NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','draft')),
  file_path         TEXT NOT NULL,
  checksum_sha256   TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ip_rule_changes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id       UUID NOT NULL REFERENCES ip_rule_sets(id) ON DELETE CASCADE,
  change_type       TEXT NOT NULL,
  rule_path         TEXT,
  before_value      JSONB,
  after_value       JSONB,
  rationale         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ip_case_outcomes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES ip_cases(id) ON DELETE CASCADE,
  issue_type              TEXT,
  response_strategy_used  TEXT,
  examiner                TEXT,
  result                  TEXT NOT NULL CHECK (result IN ('accepted','partial_refusal','final_refusal','abandoned','other')),
  cycles_to_resolution    INTEGER,
  time_to_resolution_days INTEGER,
  resolved_at             DATE,
  notes                   TEXT,
  metadata_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_case_outcomes_case
  ON ip_case_outcomes (case_id, resolved_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ip_case_outcomes_issue_result
  ON ip_case_outcomes (issue_type, result, resolved_at DESC NULLS LAST);

ALTER TABLE ip_events
  ADD COLUMN IF NOT EXISTS rule_set_version INTEGER;

ALTER TABLE ip_issues
  ADD COLUMN IF NOT EXISTS rule_set_version INTEGER;

-- 046_credit_outcomes_correspondence_learning.sql
-- Adds correspondence/evidence/outcome/learning tables for deterministic credit workflows.

CREATE TABLE IF NOT EXISTS credit_correspondence (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id         UUID NOT NULL REFERENCES credit_actions(id) ON DELETE CASCADE,
  issue_id          UUID REFERENCES credit_issues(id) ON DELETE SET NULL,
  person_id         UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('mail', 'email', 'fax', 'portal', 'internal')),
  subject           TEXT,
  body_text         TEXT NOT NULL,
  attachments_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  tracking_number   TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_correspondence_action ON credit_correspondence(action_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_correspondence_person ON credit_correspondence(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_evidence (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id          UUID NOT NULL REFERENCES credit_issues(id) ON DELETE CASCADE,
  person_id         UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  evidence_type     TEXT NOT NULL,
  file_path         TEXT NOT NULL,
  notes             TEXT,
  metadata_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_evidence_issue ON credit_evidence(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_evidence_person ON credit_evidence(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_action_outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id         UUID NOT NULL REFERENCES credit_actions(id) ON DELETE CASCADE,
  issue_id          UUID REFERENCES credit_issues(id) ON DELETE SET NULL,
  person_id         UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  bureau            TEXT,
  bureau_response   JSONB NOT NULL DEFAULT '{}'::jsonb,
  result            TEXT NOT NULL CHECK (result IN ('won', 'partially_won', 'lost', 'no_change', 'pending')),
  score_delta       INTEGER NOT NULL DEFAULT 0,
  updated_fields    JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_action_outcomes_action ON credit_action_outcomes(action_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_action_outcomes_person ON credit_action_outcomes(person_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS credit_learning_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type        TEXT NOT NULL,
  action_type       TEXT NOT NULL,
  bureau            TEXT,
  win               BOOLEAN NOT NULL DEFAULT false,
  severity          INTEGER NOT NULL DEFAULT 0,
  win_prob          NUMERIC(6,3) NOT NULL DEFAULT 0.000,
  score_delta       INTEGER NOT NULL DEFAULT 0,
  metadata_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_learning_events_key ON credit_learning_events(issue_type, action_type, bureau, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_learning_events_win ON credit_learning_events(win, created_at DESC);


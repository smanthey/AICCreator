-- 042_credit_agent_phase1.sql
-- Phase 1 foundation for deterministic, compliance-first credit repair/build workflows.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS credit_person_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key     TEXT NOT NULL UNIQUE,
  full_name        TEXT,
  legal_name       TEXT,
  dob              DATE,
  ssn_last4        TEXT,
  phone            TEXT,
  email            TEXT,
  current_address  TEXT,
  metadata_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  bureau           TEXT NOT NULL CHECK (bureau IN ('equifax', 'experian', 'transunion', 'other')),
  report_date      DATE NOT NULL,
  source_type      TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'upload', 'api', 'mail')),
  source_path      TEXT,
  source_hash      TEXT,
  raw_text         TEXT,
  metadata_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_reports_dedupe
  ON credit_reports (person_id, bureau, report_date, COALESCE(source_hash, ''));

CREATE INDEX IF NOT EXISTS idx_credit_reports_person_date
  ON credit_reports (person_id, report_date DESC);

CREATE TABLE IF NOT EXISTS credit_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id             UUID NOT NULL REFERENCES credit_reports(id) ON DELETE CASCADE,
  person_id             UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  bureau                TEXT NOT NULL CHECK (bureau IN ('equifax', 'experian', 'transunion', 'other')),
  item_type             TEXT NOT NULL CHECK (item_type IN ('trade_line', 'collection', 'inquiry', 'public_record', 'personal_info', 'other')),
  account_ref           TEXT,
  furnisher_name        TEXT,
  creditor_type         TEXT,
  account_status        TEXT,
  payment_status        TEXT,
  opened_date           DATE,
  last_reported_date    DATE,
  dofd_date             DATE,
  last_payment_date     DATE,
  closed_date           DATE,
  monthly_payment       NUMERIC(12,2),
  balance               NUMERIC(12,2),
  credit_limit          NUMERIC(12,2),
  past_due_amount       NUMERIC(12,2),
  high_balance          NUMERIC(12,2),
  terms                 TEXT,
  remarks               TEXT,
  is_disputed           BOOLEAN NOT NULL DEFAULT FALSE,
  raw_data_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_items_report_type
  ON credit_items (report_id, item_type);
CREATE INDEX IF NOT EXISTS idx_credit_items_person_type
  ON credit_items (person_id, item_type);
CREATE INDEX IF NOT EXISTS idx_credit_items_account_ref
  ON credit_items (person_id, account_ref);

CREATE TABLE IF NOT EXISTS credit_issues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  report_id             UUID REFERENCES credit_reports(id) ON DELETE SET NULL,
  item_id               UUID REFERENCES credit_items(id) ON DELETE SET NULL,
  issue_type            TEXT NOT NULL,
  severity              TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info', 'warn', 'blocker')),
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  title                 TEXT NOT NULL,
  details               TEXT,
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  score_impact_estimate INTEGER NOT NULL DEFAULT 0,
  rule_key              TEXT,
  recommended_workflow  TEXT,
  evidence_required     TEXT[] NOT NULL DEFAULT '{}',
  evidence_present      TEXT[] NOT NULL DEFAULT '{}',
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_issues_person_status
  ON credit_issues (person_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_credit_issues_report
  ON credit_issues (report_id, issue_type);

CREATE TABLE IF NOT EXISTS credit_actions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  issue_id              UUID REFERENCES credit_issues(id) ON DELETE SET NULL,
  action_type           TEXT NOT NULL,
  channel               TEXT NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual', 'bureau', 'furnisher', 'collector', 'cfpb', 'internal')),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sent', 'completed', 'blocked', 'cancelled')),
  recipient             TEXT,
  payload_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_decision_id    UUID,
  sent_at               TIMESTAMPTZ,
  response_due_date     DATE,
  completed_at          TIMESTAMPTZ,
  result_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_actions_person_status
  ON credit_actions (person_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_actions_issue
  ON credit_actions (issue_id, action_type);

CREATE TABLE IF NOT EXISTS credit_letters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  issue_id              UUID REFERENCES credit_issues(id) ON DELETE SET NULL,
  action_id             UUID REFERENCES credit_actions(id) ON DELETE SET NULL,
  letter_type           TEXT NOT NULL,
  template_key          TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  subject               TEXT,
  body_text             TEXT NOT NULL,
  body_hash             TEXT NOT NULL,
  variables_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_letters_person
  ON credit_letters (person_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_letters_action_version
  ON credit_letters (action_id, version)
  WHERE action_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_deadlines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             UUID NOT NULL REFERENCES credit_person_profiles(id) ON DELETE CASCADE,
  issue_id              UUID REFERENCES credit_issues(id) ON DELETE SET NULL,
  action_id             UUID REFERENCES credit_actions(id) ON DELETE SET NULL,
  deadline_type         TEXT NOT NULL,
  due_date              DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'missed')),
  notes                 TEXT,
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_deadlines_open_due
  ON credit_deadlines (status, due_date ASC);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain                TEXT NOT NULL,
  action                TEXT NOT NULL,
  allowed               BOOLEAN NOT NULL,
  reason                TEXT NOT NULL,
  evidence_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_by            TEXT NOT NULL DEFAULT 'system',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_domain_created
  ON policy_decisions (domain, created_at DESC);

ALTER TABLE credit_actions
  ADD CONSTRAINT fk_credit_actions_policy
  FOREIGN KEY (policy_decision_id) REFERENCES policy_decisions(id) ON DELETE SET NULL;

-- Keep updated_at behavior consistent
DROP TRIGGER IF EXISTS credit_person_profiles_updated_at ON credit_person_profiles;
CREATE TRIGGER credit_person_profiles_updated_at
  BEFORE UPDATE ON credit_person_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_reports_updated_at ON credit_reports;
CREATE TRIGGER credit_reports_updated_at
  BEFORE UPDATE ON credit_reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_items_updated_at ON credit_items;
CREATE TRIGGER credit_items_updated_at
  BEFORE UPDATE ON credit_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_issues_updated_at ON credit_issues;
CREATE TRIGGER credit_issues_updated_at
  BEFORE UPDATE ON credit_issues
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_actions_updated_at ON credit_actions;
CREATE TRIGGER credit_actions_updated_at
  BEFORE UPDATE ON credit_actions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_deadlines_updated_at ON credit_deadlines;
CREATE TRIGGER credit_deadlines_updated_at
  BEFORE UPDATE ON credit_deadlines
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

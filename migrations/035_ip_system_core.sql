-- Migration 035: IP system core schema for ingestion, case tracking, deadlines, and issue parsing.

CREATE TABLE IF NOT EXISTS ip_cases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_type                 TEXT NOT NULL CHECK (ip_type IN ('TM','PT','CR')),
  case_key                TEXT UNIQUE,
  primary_mark_text       TEXT,
  serial_number           TEXT,
  registration_number     TEXT,
  patent_application_number TEXT,
  patent_number           TEXT,
  copyright_reg_number    TEXT,
  owner_name              TEXT,
  owner_entity_type       TEXT,
  filing_basis            TEXT,
  classes                 TEXT[],
  status                  TEXT NOT NULL DEFAULT 'open',
  source_discovered_from  TEXT,
  confidence              NUMERIC(4,3) NOT NULL DEFAULT 0.500,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ip_cases_tm_serial
  ON ip_cases (serial_number)
  WHERE serial_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ip_cases_tm_reg
  ON ip_cases (registration_number)
  WHERE registration_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ip_cases_status
  ON ip_cases (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ip_documents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID REFERENCES ip_cases(id) ON DELETE SET NULL,
  source_type             TEXT NOT NULL CHECK (source_type IN ('notes','mail','files','uspto_pull','manual')),
  source_machine          TEXT,
  source_path             TEXT,
  title                   TEXT,
  doc_type                TEXT NOT NULL DEFAULT 'other',
  doc_date                DATE,
  sha256                  TEXT NOT NULL UNIQUE,
  mime_type               TEXT,
  file_path_original      TEXT,
  file_path_normalized    TEXT,
  extracted_text          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_documents_case
  ON ip_documents (case_id, doc_date DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ip_documents_type
  ON ip_documents (doc_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ip_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES ip_cases(id) ON DELETE CASCADE,
  doc_id                  UUID REFERENCES ip_documents(id) ON DELETE SET NULL,
  event_type              TEXT NOT NULL,
  event_date              DATE,
  summary                 TEXT,
  metadata_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_events_case_date
  ON ip_events (case_id, event_date DESC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS ip_issues (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES ip_cases(id) ON DELETE CASCADE,
  event_id                UUID REFERENCES ip_events(id) ON DELETE SET NULL,
  detected_from_doc_id    UUID REFERENCES ip_documents(id) ON DELETE SET NULL,
  issue_type              TEXT NOT NULL,
  severity                TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','blocker')),
  extracted_text_snippet  TEXT,
  recommended_actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_issues_open
  ON ip_issues (status, severity, created_at DESC)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS ip_deadlines (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES ip_cases(id) ON DELETE CASCADE,
  trigger_event_id        UUID REFERENCES ip_events(id) ON DELETE SET NULL,
  deadline_type           TEXT NOT NULL,
  due_date                DATE NOT NULL,
  source                  TEXT NOT NULL DEFAULT 'doc_parse',
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','missed')),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_deadlines_due
  ON ip_deadlines (status, due_date ASC)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS ip_entities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type             TEXT NOT NULL,
  value                   TEXT NOT NULL,
  normalized_value        TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, value)
);

CREATE TABLE IF NOT EXISTS ip_document_entities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id                  UUID NOT NULL REFERENCES ip_documents(id) ON DELETE CASCADE,
  entity_id               UUID NOT NULL REFERENCES ip_entities(id) ON DELETE CASCADE,
  offset_start            INTEGER,
  offset_end              INTEGER,
  confidence              NUMERIC(4,3) NOT NULL DEFAULT 0.800,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(doc_id, entity_id, offset_start, offset_end)
);

CREATE TABLE IF NOT EXISTS ip_sync_runs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type               TEXT NOT NULL,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  stats_json              JSONB NOT NULL DEFAULT '{}'::jsonb,
  error                   TEXT
);

CREATE TABLE IF NOT EXISTS ip_pipeline_state (
  id                      BIGSERIAL PRIMARY KEY,
  state_key               TEXT NOT NULL UNIQUE,
  state_value             TEXT NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json           JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO ip_pipeline_state (state_key, state_value, metadata_json)
VALUES
  ('ingestion_complete', 'false', '{}'::jsonb),
  ('parsing_complete', 'false', '{}'::jsonb),
  ('tagging_complete', 'false', '{}'::jsonb),
  ('categorization_complete', 'false', '{}'::jsonb),
  ('paralegal_enabled', 'false', '{}'::jsonb)
ON CONFLICT (state_key) DO NOTHING;

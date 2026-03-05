-- ────────────────────────────────────────────────────────────────────────────
-- 065_content_pipeline_core.sql
-- aicreator content pipeline: brief → draft → review → publish
--
-- Tables:
--   content_briefs        — intake spec for a content piece
--   content_drafts        — LLM-generated drafts, one or more per brief
--   content_variants      — channel-specific versions of a draft
--   content_approvals     — human review decisions
--   content_publish_log   — final publish record + reach/conversion tracking
--
-- NOTE: content_briefs already exists from migration 011 with a different
--       schema (brand_slug TEXT). This migration adds pipeline fields safely.
-- ────────────────────────────────────────────────────────────────────────────

-- ── Enum types (idempotent) ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE content_brief_status AS ENUM (
    'pending','in_draft','ready_review','approved','published','rejected','archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE content_draft_status AS ENUM (
    'generating','scoring','pending_review','approved','rejected','published'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE content_channel AS ENUM (
    'email','sms','blog','instagram','linkedin','push_notification'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE content_approval_decision AS ENUM (
    'approve','reject','request_changes'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── content_briefs ──────────────────────────────────────────────────────────
-- Create fresh if it doesn't exist. If it does exist (from migration 011),
-- all the ADD COLUMN IF NOT EXISTS blocks below will fill in the gaps.

CREATE TABLE IF NOT EXISTS content_briefs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID,                             -- FK added below after column exists
  channel           TEXT,                             -- use TEXT here; typed via ALTER below
  topic             TEXT,
  target_audience   TEXT,
  tone              TEXT,
  keywords          TEXT[],
  goal              TEXT,
  max_length_words  INT,
  reference_urls    TEXT[],
  product_ids       TEXT[],
  campaign_id       TEXT,
  publish_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  status            TEXT,                             -- typed via ALTER below
  created_by        TEXT,
  task_id           UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Add all pipeline columns safely (idempotent) ────────────────────────────
-- Columns that existed in the 011 schema are skipped by IF NOT EXISTS.
-- Using TEXT for enum-typed columns to avoid type-not-found edge cases;
-- we cast them below after confirming the enum types exist.

ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS brand_id          UUID;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS channel           TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS topic             TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS target_audience   TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS tone              TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS keywords          TEXT[];
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS goal              TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS max_length_words  INT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS reference_urls    TEXT[];
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS product_ids       TEXT[];
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS campaign_id       TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS publish_at        TIMESTAMPTZ;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS expires_at        TIMESTAMPTZ;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS status            TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS created_by        TEXT;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS task_id           UUID;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ;
ALTER TABLE content_briefs ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE content_briefs ALTER COLUMN updated_at SET DEFAULT NOW();

-- Set status default for any existing rows (brand_slug-only 011 rows)
UPDATE content_briefs SET status = 'pending' WHERE status IS NULL;

-- ── FK constraint on brand_id ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE content_briefs
    ADD CONSTRAINT fk_content_briefs_brand
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Indexes (only after columns are confirmed to exist) ──────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='content_briefs' AND column_name='brand_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='content_briefs' AND column_name='status')
  THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE tablename='content_briefs'
                     AND indexname='idx_content_briefs_brand_status') THEN
      CREATE INDEX idx_content_briefs_brand_status ON content_briefs (brand_id, status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE tablename='content_briefs'
                     AND indexname='idx_content_briefs_publish_at') THEN
      CREATE INDEX idx_content_briefs_publish_at ON content_briefs (publish_at)
        WHERE publish_at IS NOT NULL;
    END IF;
  END IF;
END $$;

-- ── content_drafts ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_drafts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id          UUID        NOT NULL REFERENCES content_briefs(id) ON DELETE CASCADE,
  variant_number    INT         NOT NULL DEFAULT 1,
  model_used        TEXT,
  prompt_version    TEXT,
  tokens_input      INT,
  tokens_output     INT,
  generation_ms     INT,
  body_md           TEXT,
  subject_line      TEXT,
  preview_text      TEXT,
  headline          TEXT,
  cta_text          TEXT,
  cta_url           TEXT,
  image_prompt      TEXT,
  score_quality     NUMERIC(4,3),
  score_relevancy   NUMERIC(4,3),
  score_toxicity    NUMERIC(4,3),
  score_compliance  NUMERIC(4,3),
  score_brand_tone  NUMERIC(4,3),
  scoring_model     TEXT,
  scoring_notes     JSONB,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  review_notes      TEXT,
  status            TEXT NOT NULL DEFAULT 'generating',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brief_id, variant_number)
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_brief_status
  ON content_drafts (brief_id, status);

CREATE INDEX IF NOT EXISTS idx_content_drafts_pending_review
  ON content_drafts (status, score_quality DESC)
  WHERE status = 'pending_review';

-- ── content_variants ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_variants (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id               UUID        NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  brief_id               UUID        NOT NULL REFERENCES content_briefs(id) ON DELETE CASCADE,
  channel                TEXT,
  body                   TEXT,
  subject_line           TEXT,
  preview_text           TEXT,
  cta_text               TEXT,
  cta_url                TEXT,
  image_url              TEXT,
  character_count        INT,
  experiment_variant_id  BIGINT,
  is_explore             BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_for          TIMESTAMPTZ,
  publish_job_id         TEXT,
  published_at           TIMESTAMPTZ,
  external_id            TEXT,
  publish_status         TEXT,
  publish_error          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_variants_draft
  ON content_variants (draft_id);

CREATE INDEX IF NOT EXISTS idx_content_variants_publish_queue
  ON content_variants (scheduled_for, channel)
  WHERE publish_status = 'queued';

-- ── content_approvals ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_approvals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          UUID        NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  brief_id          UUID        NOT NULL REFERENCES content_briefs(id) ON DELETE CASCADE,
  reviewer_user_id  TEXT        NOT NULL,
  decision          TEXT        NOT NULL,
  notes             TEXT,
  change_request    TEXT,
  resolved_draft_id UUID        REFERENCES content_drafts(id),
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_approvals_draft
  ON content_approvals (draft_id, decided_at DESC);

-- ── content_publish_log ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_publish_log (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id               UUID        NOT NULL REFERENCES content_variants(id),
  draft_id                 UUID        NOT NULL REFERENCES content_drafts(id),
  brief_id                 UUID        NOT NULL REFERENCES content_briefs(id),
  brand_id                 UUID        REFERENCES brands(id),
  channel                  TEXT        NOT NULL,
  external_id              TEXT,
  published_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reach                    INT,
  opens                    INT,
  clicks                   INT,
  conversions              INT,
  revenue_attributed       NUMERIC(12,2),
  attribution_window_hours INT         NOT NULL DEFAULT 72,
  last_metric_sync         TIMESTAMPTZ,
  experiment_id            BIGINT,
  experiment_variant_id    BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_publish_log_brief
  ON content_publish_log (brief_id, published_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='content_publish_log' AND column_name='brand_id') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE tablename='content_publish_log'
                     AND indexname='idx_content_publish_log_brand') THEN
      CREATE INDEX idx_content_publish_log_brand
        ON content_publish_log (brand_id, channel, published_at DESC);
    END IF;
  END IF;
END $$;

-- ── updated_at triggers ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
  CREATE TRIGGER content_briefs_updated_at
    BEFORE UPDATE ON content_briefs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER content_drafts_updated_at
    BEFORE UPDATE ON content_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER content_variants_updated_at
    BEFORE UPDATE ON content_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 1;

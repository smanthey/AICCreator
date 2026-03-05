-- Migration 087: Pinterest publish queue for Media Hub
-- Supports human-in-the-loop posting first, then safe automation.

CREATE TABLE IF NOT EXISTS pinterest_publish_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_index_id       UUID NOT NULL REFERENCES file_index(id) ON DELETE CASCADE,
  brand_slug          TEXT,
  pinterest_account   TEXT NOT NULL,
  board_name          TEXT NOT NULL,
  pin_title           TEXT,
  pin_description     TEXT,
  destination_url     TEXT,
  hashtags            TEXT[] NOT NULL DEFAULT '{}',
  caption_variants    JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'draft', -- draft|approved|posted|failed|archived
  review_notes        TEXT,
  created_by          TEXT,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  scheduled_for       TIMESTAMPTZ,
  posted_at           TIMESTAMPTZ,
  external_pin_id     TEXT,
  external_raw_json   JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pinterest_publish_queue_status_chk
    CHECK (status IN ('draft','approved','posted','failed','archived'))
);

CREATE INDEX IF NOT EXISTS idx_pinterest_publish_queue_status
  ON pinterest_publish_queue(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pinterest_publish_queue_brand
  ON pinterest_publish_queue(brand_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pinterest_publish_queue_account
  ON pinterest_publish_queue(pinterest_account, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pinterest_publish_queue_scheduled
  ON pinterest_publish_queue(scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pinterest_publish_queue_file
  ON pinterest_publish_queue(file_index_id);

CREATE OR REPLACE FUNCTION set_pinterest_publish_queue_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pinterest_publish_queue_updated_at ON pinterest_publish_queue;
CREATE TRIGGER trg_pinterest_publish_queue_updated_at
BEFORE UPDATE ON pinterest_publish_queue
FOR EACH ROW EXECUTE FUNCTION set_pinterest_publish_queue_updated_at();

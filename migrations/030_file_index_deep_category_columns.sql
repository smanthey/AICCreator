-- Migration 030: Deep categorization fields on file_index.
-- Aligns deterministic + semantic categorization on the canonical architect table.

ALTER TABLE file_index
  ADD COLUMN IF NOT EXISTS category_confidence NUMERIC(6,5),
  ADD COLUMN IF NOT EXISTS category_reason     TEXT,
  ADD COLUMN IF NOT EXISTS sub_category        TEXT,
  ADD COLUMN IF NOT EXISTS work_needed         TEXT,
  ADD COLUMN IF NOT EXISTS review_status       TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_file_index_confidence
  ON file_index (category_confidence)
  WHERE category_confidence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_file_index_sub_category
  ON file_index (sub_category)
  WHERE sub_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_file_index_work_needed
  ON file_index (work_needed)
  WHERE work_needed IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_file_index_review_status
  ON file_index (review_status);

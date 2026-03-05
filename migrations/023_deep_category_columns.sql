-- Migration 023: Add deep categorization columns to files table
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a second layer of classification on top of the basic category column.
-- Nothing here moves or deletes files — purely metadata.

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS sub_category      TEXT,
  ADD COLUMN IF NOT EXISTS work_needed       TEXT,
  ADD COLUMN IF NOT EXISTS review_status     TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reviewer_notes    TEXT;

CREATE INDEX IF NOT EXISTS idx_files_work_needed    ON files (work_needed) WHERE work_needed IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_review_status  ON files (review_status);
CREATE INDEX IF NOT EXISTS idx_files_sub_category   ON files (sub_category) WHERE sub_category IS NOT NULL;

-- Mark obvious cache/junk as already reviewed (use SUBSTRING instead of ext column)
UPDATE files
SET review_status = 'ignored'
WHERE category = 'cache'
   OR filename IN ('.DS_Store','Thumbs.db','desktop.ini','.localized')
   OR LOWER(SUBSTRING(filename FROM '[^.]+$')) IN ('pyc','pyo','o','a','class','map','lock','pid');

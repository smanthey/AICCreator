-- Migration 016: Add brand column to claw.files (lives in the separate 'claw' database)
-- Run against: claw DB (not claw_architect)
-- Adds brand detection column so files can be attributed to a SMAT brand/project.

ALTER TABLE files ADD COLUMN IF NOT EXISTS brand TEXT;

-- Index for brand-filtered queries (dashboard, search, stats)
CREATE INDEX IF NOT EXISTS idx_files_brand        ON files (brand);
CREATE INDEX IF NOT EXISTS idx_files_cat_brand    ON files (category, brand);
CREATE INDEX IF NOT EXISTS idx_files_machine_cat  ON files (source_machine, category);

-- Helpful combined index for the classifier query (WHERE category IS NULL)
CREATE INDEX IF NOT EXISTS idx_files_unclassified ON files (source_machine, indexed_at)
  WHERE category IS NULL;

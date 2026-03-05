-- Migration 017: Add brand + path columns to claw_architect.file_index
-- Enables brand attribution in the semantic classifier pipeline.

ALTER TABLE file_index ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE file_index ADD COLUMN IF NOT EXISTS source_machine TEXT; -- for multi-device awareness

CREATE INDEX IF NOT EXISTS idx_file_index_brand        ON file_index (brand);
CREATE INDEX IF NOT EXISTS idx_file_index_source       ON file_index (source_machine);
CREATE INDEX IF NOT EXISTS idx_file_index_cat_brand    ON file_index (category, brand);
CREATE INDEX IF NOT EXISTS idx_file_index_unclassified ON file_index (hostname, indexed_at)
  WHERE classified_at IS NULL;

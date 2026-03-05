-- Migration 018: Improve duplicate_groups for reorganization workflow
-- Adds wasted_bytes tracking, brand context, and resolution fields.

ALTER TABLE duplicate_groups
  ADD COLUMN IF NOT EXISTS wasted_bytes   BIGINT,
  ADD COLUMN IF NOT EXISTS brand          TEXT,
  ADD COLUMN IF NOT EXISTS category       TEXT,
  ADD COLUMN IF NOT EXISTS nas_copy_id    BIGINT,   -- file_id of the NAS canonical if it exists
  ADD COLUMN IF NOT EXISTS resolution     TEXT,     -- 'keep_nas' | 'move_to_nas' | 'delete_dupes' | 'review'
  ADD COLUMN IF NOT EXISTS resolved_at    TIMESTAMP;

-- Index for status-based reorganization sweeps
CREATE INDEX IF NOT EXISTS idx_dupgroups_status     ON duplicate_groups (status);
CREATE INDEX IF NOT EXISTS idx_dupgroups_brand      ON duplicate_groups (brand);
CREATE INDEX IF NOT EXISTS idx_dupgroups_resolution ON duplicate_groups (resolution);

-- Widen the file_id column from integer → bigint to match files.id
ALTER TABLE duplicate_group_members
  ALTER COLUMN file_id TYPE BIGINT;

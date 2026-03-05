-- migrations/008_vault_files.sql
-- Extends the existing vault_files table with architect-specific columns.
-- Safe to run multiple times (all ADD COLUMN IF NOT EXISTS).
--
-- Existing NAS schema has: id, sha256, canonical_path, category,
--   size_bytes, source_machine, source_path, verified_at, created_at
--
-- We add: filename, ext, mime, plan_id, task_id, tags, notes

-- Create a minimal base table if this database does not already have vault_files.
-- This keeps Architect migrations self-contained on fresh installs.
CREATE TABLE IF NOT EXISTS vault_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256        TEXT UNIQUE NOT NULL,
  canonical_path TEXT,
  category      TEXT,
  size_bytes    BIGINT,
  source_machine TEXT,
  source_path   TEXT,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS filename      TEXT;
ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS ext           TEXT;
ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS mime          TEXT;
ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS plan_id       UUID REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS task_id       UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS tags          TEXT[]      DEFAULT '{}';
ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS notes         TEXT;

-- Index for path-based lookups by architect
CREATE INDEX IF NOT EXISTS idx_vault_files_plan   ON vault_files(plan_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_task   ON vault_files(task_id);
CREATE INDEX IF NOT EXISTS idx_vault_files_copied ON vault_files(created_at DESC);

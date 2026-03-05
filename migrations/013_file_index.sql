-- migrations/013_file_index.sql
-- Persistent file index for local filesystem indexing + semantic classification.
--
-- Run on NAS Postgres:
--   psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -f migrations/013_file_index.sql

-- ── Core file index ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_index (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Location
  path            TEXT        NOT NULL,          -- absolute path on indexing machine
  hostname        TEXT        NOT NULL,          -- which machine owns this path
  name            TEXT        NOT NULL,          -- basename
  ext             TEXT,                          -- lowercase, no dot

  -- Content identity
  sha256          TEXT,                          -- hex SHA-256 of file contents
  size_bytes      BIGINT,
  mtime           TIMESTAMPTZ,                   -- file modification time

  -- Classification
  mime            TEXT,
  category        TEXT,                          -- image|video|audio|document|text|data|code|archive|unknown
  semantic_tags   TEXT[],                        -- LLM-assigned tags  e.g. ['invoice','finance','2024']
  semantic_summary TEXT,                         -- 1-2 sentence LLM description of content
  language        TEXT,                          -- detected language for text files

  -- Full-text search (populated for text/doc/pdf/code files)
  content_text    TEXT,                          -- extracted plain text
  content_tsv     TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(content_text, '') || ' ' ||
                                          coalesce(semantic_summary, '') || ' ' ||
                                          coalesce(name, ''))
                  ) STORED,

  -- Lineage
  plan_id         UUID,
  task_id         UUID,
  indexed_at      TIMESTAMPTZ DEFAULT now(),
  classified_at   TIMESTAMPTZ,                   -- set when semantic pass completes
  classify_model  TEXT                           -- e.g. 'claude-haiku-4-5-20251001'
);

-- ── Unique constraint: one row per (path, hostname) ──────────────────────────
-- ON CONFLICT (path, hostname) allows upsert on re-index.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_file_index_path_host
  ON file_index (path, hostname);

-- ── Hash dedup lookup ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_file_index_sha256
  ON file_index (sha256) WHERE sha256 IS NOT NULL;

-- ── Category filter ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_file_index_category
  ON file_index (category);

-- ── Full-text search ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_file_index_tsv
  ON file_index USING GIN (content_tsv);

-- ── Tag search ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_file_index_tags
  ON file_index USING GIN (semantic_tags);

-- ── Recency ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_file_index_indexed_at
  ON file_index (indexed_at DESC);

-- ── Index run log — tracks each full scan for delta/incremental logic ─────────
CREATE TABLE IF NOT EXISTS index_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname      TEXT        NOT NULL,
  root_path     TEXT        NOT NULL,
  started_at    TIMESTAMPTZ DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  files_scanned INT         DEFAULT 0,
  files_new     INT         DEFAULT 0,
  files_updated INT         DEFAULT 0,
  files_skipped INT         DEFAULT 0,
  plan_id       UUID,
  task_id       UUID
);

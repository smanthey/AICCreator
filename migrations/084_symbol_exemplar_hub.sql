-- Central symbol exemplar hub for cross-repo reuse and QA feature acceleration.

CREATE TABLE IF NOT EXISTS symbol_exemplar_repos (
  repo_key TEXT PRIMARY KEY,
  source_url TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  last_seen_indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS symbol_exemplar_symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_key TEXT NOT NULL REFERENCES symbol_exemplar_repos(repo_key) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_kind TEXT,
  symbol_file TEXT NOT NULL,
  symbol_signature TEXT,
  symbol_summary TEXT,
  language TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  source_indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_key, feature_key, symbol_id)
);

CREATE INDEX IF NOT EXISTS idx_symbol_exemplar_symbols_repo_feature
  ON symbol_exemplar_symbols (repo_key, feature_key, score DESC);

CREATE INDEX IF NOT EXISTS idx_symbol_exemplar_symbols_feature
  ON symbol_exemplar_symbols (feature_key, score DESC);

CREATE TABLE IF NOT EXISTS symbol_feature_playbooks (
  feature_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommended_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
  implementation_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


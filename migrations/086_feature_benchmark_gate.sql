-- Feature benchmark scoring + strict merge gate persistence.

CREATE TABLE IF NOT EXISTS feature_benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_benchmark_runs_repo_date
  ON feature_benchmark_runs (repo_key, run_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS feature_benchmark_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES feature_benchmark_runs(id) ON DELETE CASCADE,
  repo_key TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  feature_label TEXT NOT NULL,
  feature_score NUMERIC(6,2) NOT NULL,
  exemplar_mean_score NUMERIC(6,2) NOT NULL,
  exemplar_top_score NUMERIC(6,2) NOT NULL,
  compared_repo_count INTEGER NOT NULL DEFAULT 0,
  compared_repo_keys TEXT[] NOT NULL DEFAULT '{}',
  previous_score NUMERIC(6,2),
  delta_score NUMERIC(6,2),
  improved BOOLEAN NOT NULL DEFAULT FALSE,
  benchmark_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_benchmark_scores_repo_feature_created
  ON feature_benchmark_scores (repo_key, feature_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feature_benchmark_scores_repo_improved
  ON feature_benchmark_scores (repo_key, improved, created_at DESC);


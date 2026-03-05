-- Migration 085: Production KPI flywheel tables
-- Tracks KPI snapshots + autonomous improvement actions.

CREATE TABLE IF NOT EXISTS production_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_window TEXT NOT NULL DEFAULT '24h',
  score INTEGER NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  targets JSONB NOT NULL DEFAULT '{}'::jsonb,
  gaps JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  report_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_production_kpi_snapshots_generated
  ON production_kpi_snapshots (generated_at DESC);

CREATE TABLE IF NOT EXISTS production_kpi_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kpi_key TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  objective TEXT NOT NULL,
  action_type TEXT NOT NULL DEFAULT 'opencode_controller',
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_production_kpi_actions_generated
  ON production_kpi_actions (generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_kpi_actions_kpi
  ON production_kpi_actions (kpi_key, generated_at DESC);

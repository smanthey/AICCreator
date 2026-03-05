-- Migration 040: External research monitor + platform knowledge signals

CREATE TABLE IF NOT EXISTS external_update_sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_key     TEXT NOT NULL,                  -- stripe | telnyx | nextjs | ...
  source_name    TEXT NOT NULL,                  -- human label
  source_type    TEXT NOT NULL,                  -- rss | github_releases | changelog
  source_url     TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain_key, source_url)
);

CREATE INDEX IF NOT EXISTS idx_external_update_sources_enabled
  ON external_update_sources(enabled, domain_key);

CREATE TABLE IF NOT EXISTS external_updates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          UUID NOT NULL REFERENCES external_update_sources(id) ON DELETE CASCADE,
  domain_key         TEXT NOT NULL,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  published_at       TIMESTAMPTZ,
  raw_content        TEXT NOT NULL DEFAULT '',
  content_hash       TEXT NOT NULL,
  vendor_version     TEXT,
  ingest_run_id      UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_external_updates_domain_date
  ON external_updates(domain_key, COALESCE(published_at, created_at) DESC);

CREATE TABLE IF NOT EXISTS external_update_signals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id          UUID NOT NULL REFERENCES external_updates(id) ON DELETE CASCADE,
  domain_key         TEXT NOT NULL,
  signal_type        TEXT NOT NULL,              -- breaking_change | security | deprecation | feature | pricing | performance | docs
  urgency            TEXT NOT NULL,              -- critical | high | medium | low
  requires_action    BOOLEAN NOT NULL DEFAULT false,
  impact_modules     TEXT[] NOT NULL DEFAULT '{}',
  confidence         NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  summary            TEXT NOT NULL,
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_candidate     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_update_signals_urgency
  ON external_update_signals(urgency, requires_action, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_health_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source                  TEXT NOT NULL DEFAULT 'deterministic',
  repos_scanned           INTEGER NOT NULL DEFAULT 0,
  critical_violations     INTEGER NOT NULL DEFAULT 0,
  warning_violations      INTEGER NOT NULL DEFAULT 0,
  avg_stack_health_score  NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  active_vendor_signals   INTEGER NOT NULL DEFAULT 0,
  high_urgency_signals    INTEGER NOT NULL DEFAULT 0,
  recommendations         JSONB NOT NULL DEFAULT '[]'::jsonb
);


-- 069_marketplace_services_os.sql
-- Productized service catalog + AI marketplace job intake/triage

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS marketplace_service_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  price_min_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_max_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_window_days INT NOT NULL DEFAULT 7,
  inclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  upsell_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace TEXT NOT NULL,
  external_job_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget_min_usd NUMERIC(12,2),
  budget_max_usd NUMERIC(12,2),
  contact_name TEXT,
  contact_email TEXT,
  job_url TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','triaged','proposal_ready','won','lost','archived')),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_marketplace_jobs_source_id
  ON marketplace_jobs(marketplace, external_job_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_jobs_status_created
  ON marketplace_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_job_triage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  matched_offer_slug TEXT REFERENCES marketplace_service_offers(slug) ON DELETE SET NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  priority_score NUMERIC(8,4) NOT NULL DEFAULT 0,
  triage_notes TEXT,
  proposal_summary TEXT,
  recommended_price_usd NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_job_triage_job_created
  ON marketplace_job_triage(job_id, created_at DESC);

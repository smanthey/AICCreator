-- migrations/056_brand_provisioning_control_plane.sql
-- Phase 1 centralized brand email provisioning control plane.

-- Extend existing brands table (from 011_brands_and_leads.sql).
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS primary_domain TEXT,
  ADD COLUMN IF NOT EXISTS sending_subdomain TEXT,
  ADD COLUMN IF NOT EXISTS sending_domain TEXT,
  ADD COLUMN IF NOT EXISTS default_from_name TEXT,
  ADD COLUMN IF NOT EXISTS default_from_email TEXT,
  ADD COLUMN IF NOT EXISTS dns_provider TEXT,
  ADD COLUMN IF NOT EXISTS dns_zone_id TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Phoenix',
  ADD COLUMN IF NOT EXISTS public_key TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS provisioning_error TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_provisioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'brands_provisioning_status_check'
  ) THEN
    ALTER TABLE brands
      ADD CONSTRAINT brands_provisioning_status_check
      CHECK (provisioning_status IN (
        'new',
        'queued',
        'provisioning',
        'ready',
        'action_required',
        'failed'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_public_key_unique
  ON brands(public_key)
  WHERE public_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brands_provisioning_status
  ON brands(provisioning_status);

CREATE TABLE IF NOT EXISTS brand_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  maileroo_api_key_encrypted TEXT,
  stripe_webhook_secret_encrypted TEXT,
  cloudflare_api_token_encrypted TEXT,
  secrets_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id)
);

CREATE TABLE IF NOT EXISTS brand_provision_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  detail TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_brand_provision_runs_brand_started
  ON brand_provision_runs(brand_id, started_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  customer_id TEXT,
  type TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_events_brand_ts
  ON events(brand_id, ts DESC);

CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  definition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, name)
);

CREATE TABLE IF NOT EXISTS flow_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  customer_id TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_jobs_brand_status_run_at
  ON flow_jobs(brand_id, status, run_at);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  customer_id TEXT,
  provider TEXT NOT NULL DEFAULT 'maileroo',
  provider_id TEXT,
  template_id TEXT,
  variant_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'complaint', 'failed', 'unsubscribed')),
  to_email TEXT,
  subject TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_brand_status
  ON messages(brand_id, status, created_at DESC);

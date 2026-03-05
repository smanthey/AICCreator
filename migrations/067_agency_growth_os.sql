-- 067_agency_growth_os.sql
-- Agency CRM + revenue operating system tables

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agency_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  segment TEXT DEFAULT 'small_business',
  source TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead','qualified','proposal_sent','client_active','client_paused','client_churned')),
  owner TEXT DEFAULT '<USER>',
  website TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  pain_summary TEXT,
  setup_price_usd NUMERIC(12,2) DEFAULT 0,
  retainer_usd NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agency_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES agency_accounts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'new_lead'
    CHECK (stage IN ('new_lead','discovery_booked','qualified','proposal_sent','verbal_yes','closed_won','closed_lost')),
  setup_value_usd NUMERIC(12,2) DEFAULT 0,
  retainer_value_usd NUMERIC(12,2) DEFAULT 0,
  probability_pct INT NOT NULL DEFAULT 10 CHECK (probability_pct >= 0 AND probability_pct <= 100),
  expected_close_date DATE,
  next_action TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agency_case_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES agency_accounts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  baseline_summary TEXT,
  outcome_summary TEXT,
  metrics_json JSONB DEFAULT '{}'::jsonb,
  proof_links TEXT[] DEFAULT '{}'::text[],
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agency_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES agency_accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES agency_deals(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agency_accounts_status ON agency_accounts(status);
CREATE INDEX IF NOT EXISTS idx_agency_deals_stage ON agency_deals(stage);
CREATE INDEX IF NOT EXISTS idx_agency_deals_expected_close ON agency_deals(expected_close_date);
CREATE INDEX IF NOT EXISTS idx_agency_case_studies_published ON agency_case_studies(published);
CREATE INDEX IF NOT EXISTS idx_agency_activities_created_at ON agency_activities(created_at DESC);

CREATE OR REPLACE FUNCTION agency_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agency_accounts_updated_at ON agency_accounts;
CREATE TRIGGER trg_agency_accounts_updated_at
BEFORE UPDATE ON agency_accounts
FOR EACH ROW
EXECUTE FUNCTION agency_touch_updated_at();

DROP TRIGGER IF EXISTS trg_agency_deals_updated_at ON agency_deals;
CREATE TRIGGER trg_agency_deals_updated_at
BEFORE UPDATE ON agency_deals
FOR EACH ROW
EXECUTE FUNCTION agency_touch_updated_at();

DROP TRIGGER IF EXISTS trg_agency_case_studies_updated_at ON agency_case_studies;
CREATE TRIGGER trg_agency_case_studies_updated_at
BEFORE UPDATE ON agency_case_studies
FOR EACH ROW
EXECUTE FUNCTION agency_touch_updated_at();

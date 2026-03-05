-- Migration 032: Leadgen schema hardening + contact linkage
-- Ensures scraper/enrichment/send scripts use a consistent schema.

-- Brands metadata used by outbound templates
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS from_name   TEXT,
  ADD COLUMN IF NOT EXISTS brand_email TEXT;

-- Lead core fields used by scraper + enrichment
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS source          TEXT,
  ADD COLUMN IF NOT EXISTS lat             NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS lng             NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS rating          NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS review_count    INTEGER,
  ADD COLUMN IF NOT EXISTS email_source    TEXT,
  ADD COLUMN IF NOT EXISTS email_found_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_name    TEXT,
  ADD COLUMN IF NOT EXISTS contact_title   TEXT,
  ADD COLUMN IF NOT EXISTS contact_linkedin TEXT;

-- Support ON CONFLICT path when place_id is unavailable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_brand_biz_city_state_unique
  ON leads (brand_slug, business_name, city, state);

CREATE INDEX IF NOT EXISTS idx_leads_email_missing
  ON leads (brand_slug, email)
  WHERE (email IS NULL OR email = '');

CREATE INDEX IF NOT EXISTS idx_leads_updated_at
  ON leads (updated_at DESC);

-- Contact table is created by linkedin-scraper today; keep schema centralized here too.
CREATE TABLE IF NOT EXISTS leads_contacts (
  id            SERIAL PRIMARY KEY,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  title         TEXT,
  location      TEXT,
  company_name  TEXT,
  linkedin_url  TEXT UNIQUE,
  search_query  TEXT,
  source        TEXT DEFAULT 'linkedin',
  email         TEXT,
  enriched_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_contacts_company
  ON leads_contacts (LOWER(company_name));

CREATE INDEX IF NOT EXISTS idx_leads_contacts_lead_id
  ON leads_contacts (lead_id);

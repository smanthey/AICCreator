-- 068_clawhub_skill_factory.sql
-- Skill marketplace tracking for ClawHub sellable skills

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS clawhub_skill_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  problem_summary TEXT,
  audience TEXT,
  price_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  billing_model TEXT NOT NULL DEFAULT 'one_time'
    CHECK (billing_model IN ('one_time', 'subscription')),
  listing_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (listing_status IN ('draft', 'testing', 'published', 'retired')),
  source_report TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clawhub_skill_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES clawhub_skill_catalog(skill_id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'clawhub',
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_usd NUMERIC(12,2) NOT NULL CHECK (unit_price_usd >= 0),
  gross_usd NUMERIC(12,2) GENERATED ALWAYS AS (unit_price_usd * quantity) STORED,
  buyer_ref TEXT,
  notes TEXT,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clawhub_skill_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL REFERENCES clawhub_skill_catalog(skill_id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'clawhub',
  rating INT CHECK (rating >= 1 AND rating <= 5),
  sentiment TEXT
    CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clawhub_skill_sales_skill_sold_at
  ON clawhub_skill_sales(skill_id, sold_at DESC);

CREATE INDEX IF NOT EXISTS idx_clawhub_skill_feedback_skill_created
  ON clawhub_skill_feedback(skill_id, created_at DESC);

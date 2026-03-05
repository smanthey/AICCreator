-- Migration 050: SkynPatch schema hardening
-- ─────────────────────────────────────────────────────────────────────────────
-- Closes gaps between what the codebase expects and what the DB guarantees.
-- All ADD COLUMN / CREATE INDEX statements are idempotent (IF NOT EXISTS).
-- Safe to run multiple times.

-- ── email_sends ───────────────────────────────────────────────────────────────
-- Ensure every column referenced by webhook-server.js / daily-send-scheduler.js
-- is present. Most were added by 024 and 027, but cover any environments that
-- skipped a migration.

ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS delivered_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS click_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounce_type   TEXT,
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS attempt_at    TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS maileroo_id   TEXT;

-- Backfill attempt_at for any rows that predate the column
UPDATE email_sends
  SET attempt_at = COALESCE(attempt_at, sent_at, NOW())
WHERE attempt_at IS NULL;

-- Remove duplicate (lead_id, template) rows before adding unique constraint.
-- Keeps the most recently sent row per pair.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lead_id, template
      ORDER BY COALESCE(sent_at, attempt_at, NOW()) DESC, id DESC
    ) AS rn
  FROM email_sends
  WHERE lead_id IS NOT NULL AND template IS NOT NULL
)
DELETE FROM email_sends e
  USING ranked r
WHERE e.id = r.id AND r.rn > 1;

-- Unique constraint: one send record per lead per template (dedup guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_email_sends_lead_template'
      AND conrelid = 'email_sends'::regclass
  ) THEN
    ALTER TABLE email_sends
      ADD CONSTRAINT uq_email_sends_lead_template
      UNIQUE (lead_id, template);
  END IF;
END $$;

-- Indexes for fast webhook lookups
CREATE INDEX IF NOT EXISTS idx_email_sends_maileroo_id
  ON email_sends (maileroo_id) WHERE maileroo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_lead_id
  ON email_sends (lead_id);

CREATE INDEX IF NOT EXISTS idx_email_sends_status
  ON email_sends (status);

CREATE INDEX IF NOT EXISTS idx_email_sends_lead_template
  ON email_sends (lead_id, template);

-- ── leads ─────────────────────────────────────────────────────────────────────
-- All columns referenced by google-maps-scraper, email-finder, lead-pipeline,
-- lead-autopilot, and webhook-server.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS source           TEXT,
  ADD COLUMN IF NOT EXISTS lat              NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS lng              NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS rating           NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS review_count     INTEGER,
  ADD COLUMN IF NOT EXISTS email_source     TEXT,
  ADD COLUMN IF NOT EXISTS email_found_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS contact_title    TEXT,
  ADD COLUMN IF NOT EXISTS contact_linkedin TEXT;

-- Support fast "missing email" enrichment queries
CREATE INDEX IF NOT EXISTS idx_leads_email_missing
  ON leads (brand_slug, email)
  WHERE (email IS NULL OR email = '');

-- Support lead-autopilot's category-priority ORDER BY
CREATE INDEX IF NOT EXISTS idx_leads_brand_category
  ON leads (brand_slug, category, id);

-- Support webhook status updates by email
CREATE INDEX IF NOT EXISTS idx_leads_email_lower
  ON leads (LOWER(email))
  WHERE email IS NOT NULL AND email != '';

-- ── brands ────────────────────────────────────────────────────────────────────
-- daily-send-scheduler.js JOINs brands for from_name and brand_email

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS from_name   TEXT,
  ADD COLUMN IF NOT EXISTS brand_email TEXT;

-- ── orders ────────────────────────────────────────────────────────────────────
-- stripe-webhook-handler.js does CREATE TABLE IF NOT EXISTS at runtime, but it's
-- better practice to define it in migration so it exists before first webhook.

CREATE TABLE IF NOT EXISTS orders (
  id                    SERIAL PRIMARY KEY,
  stripe_session_id     TEXT UNIQUE NOT NULL,
  stripe_payment_intent TEXT,
  buyer_name            TEXT,
  buyer_email           TEXT,
  buyer_phone           TEXT,
  shipping_address      TEXT,
  amount_total          INTEGER,
  currency              TEXT DEFAULT 'usd',
  items_json            JSONB,
  status                TEXT DEFAULT 'confirmed',
  buyer_emailed         BOOLEAN DEFAULT FALSE,
  admin_emailed         BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer_email
  ON orders (LOWER(buyer_email))
  WHERE buyer_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_intent
  ON orders (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status, created_at DESC);

-- ── experiment engine ─────────────────────────────────────────────────────────
-- Ensure variant tables have all columns the engine references.

ALTER TABLE email_variants
  ADD COLUMN IF NOT EXISTS paused_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- ── email_send_log ────────────────────────────────────────────────────────────
-- Columns referenced by logEngagement() in experiment-engine.js

ALTER TABLE email_send_log
  ADD COLUMN IF NOT EXISTS opened_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- ── Refresh lead_email_summary view ───────────────────────────────────────────
CREATE OR REPLACE VIEW lead_email_summary AS
SELECT
  l.id,
  l.brand_slug,
  l.business_name,
  l.city,
  l.state,
  l.email,
  l.status       AS lead_status,
  l.category,
  es.template,
  es.status      AS send_status,
  es.sent_at,
  es.delivered_at,
  es.opened_at,
  es.open_count,
  es.clicked_at,
  es.click_count,
  es.bounce_type,
  es.maileroo_id
FROM leads l
LEFT JOIN LATERAL (
  SELECT * FROM email_sends es2
  WHERE es2.lead_id = l.id
  ORDER BY es2.id DESC
  LIMIT 1
) es ON TRUE;

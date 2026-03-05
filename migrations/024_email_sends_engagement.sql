-- Migration 024: Add engagement tracking columns to email_sends
-- ─────────────────────────────────────────────────────────────────────────────
-- Supports Maileroo webhook events: delivered, bounce, open, click, unsubscribe

ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS delivered_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS opened_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS open_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS click_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounce_type   TEXT,      -- 'hard', 'soft', 'unknown'
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMP DEFAULT NOW();

-- Add plan_id and task_id if missing from original 011 migration
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS plan_id  TEXT,
  ADD COLUMN IF NOT EXISTS task_id  TEXT;

-- Indexes for webhook lookups
CREATE INDEX IF NOT EXISTS idx_email_sends_maileroo_id ON email_sends (maileroo_id) WHERE maileroo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_sends_lead_id     ON email_sends (lead_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_status      ON email_sends (status);

-- Add email column to leads if not already present (from 011)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS plan_id  TEXT,
  ADD COLUMN IF NOT EXISTS task_id  TEXT;

-- Useful view: lead + send status
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
  es.bounce_type
FROM leads l
LEFT JOIN LATERAL (
  SELECT * FROM email_sends es2 WHERE es2.lead_id = l.id ORDER BY es2.id DESC LIMIT 1
) es ON TRUE;

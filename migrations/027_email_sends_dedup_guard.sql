-- Migration 027: Email sends dedup guard
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: email_sends has no unique constraint on (lead_id, template).
-- A race condition (two scheduler runs overlapping) or a crashed INSERT
-- after a successful Maileroo API call could cause duplicate sends.
--
-- Solution:
--   1. Unique constraint on (lead_id, template) — prevents any second record
--      for the same lead+template combination at the DB level.
--   2. status column now supports: 'sending' | 'sent' | 'failed' | 'bounced' | 'unsubscribed'
--      'sending' is recorded BEFORE the API call, updated after.
--   3. attempt_at column tracks when the send was attempted.
--   4. The scheduler uses INSERT ... ON CONFLICT DO NOTHING to claim the slot
--      atomically before calling Maileroo. If it gets 0 rows back, it skips.

-- Unique constraint: one send record per lead per template
-- ON CONFLICT DO NOTHING lets the scheduler skip safely without raising an error.
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS attempt_at  TIMESTAMPTZ DEFAULT NOW();

-- Only add the constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_email_sends_lead_template'
  ) THEN
    ALTER TABLE email_sends
      ADD CONSTRAINT uq_email_sends_lead_template
      UNIQUE (lead_id, template);
  END IF;
END $$;

-- Index for fast "already sent?" lookups (complements the unique constraint)
CREATE INDEX IF NOT EXISTS idx_email_sends_lead_template
  ON email_sends (lead_id, template);

-- Backfill attempt_at for existing records where it's null
UPDATE email_sends
  SET attempt_at = COALESCE(sent_at, NOW())
  WHERE attempt_at IS NULL;

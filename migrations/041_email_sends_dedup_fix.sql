-- Migration 041: Ensure email_sends dedup guard exists in live DB
-- Some environments missed migration 027 due ordering conflicts.

ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS attempt_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill attempt_at first
UPDATE email_sends
SET attempt_at = COALESCE(attempt_at, sent_at, NOW())
WHERE attempt_at IS NULL;

-- Remove duplicates keeping the most recent row per (lead_id, template)
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
WHERE e.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_email_sends_lead_template'
      AND conrelid = 'email_sends'::regclass
  ) THEN
    ALTER TABLE email_sends
      ADD CONSTRAINT uq_email_sends_lead_template
      UNIQUE (lead_id, template);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_sends_lead_template
  ON email_sends (lead_id, template);


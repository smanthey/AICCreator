-- 043_loyalty_core.sql
-- First-party loyalty system for webhook-driven points + outreach automation.

CREATE TABLE IF NOT EXISTS loyalty_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL DEFAULT 'internal',
  external_ref      TEXT,
  email             TEXT,
  phone             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  wallet_pass_id    TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive','blocked')),
  metadata_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_members_email ON loyalty_members (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_loyalty_members_phone ON loyalty_members (phone);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_wallet_pass ON loyalty_members (wallet_pass_id);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  member_id         UUID PRIMARY KEY REFERENCES loyalty_members(id) ON DELETE CASCADE,
  points_balance    INTEGER NOT NULL DEFAULT 0,
  lifetime_points   INTEGER NOT NULL DEFAULT 0,
  tier              TEXT NOT NULL DEFAULT 'base'
                    CHECK (tier IN ('base','silver','gold','platinum')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  source_provider   TEXT NOT NULL,
  source_event_id   TEXT,
  source_event_type TEXT,
  tx_type           TEXT NOT NULL CHECK (tx_type IN ('earn','redeem','adjust','expire')),
  points_delta      INTEGER NOT NULL,
  amount_cents      INTEGER,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_provider, source_event_id, tx_type)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_member_time ON loyalty_transactions (member_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS loyalty_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  event_type        TEXT,
  event_id          TEXT,
  signature_valid   BOOLEAN NOT NULL DEFAULT false,
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'queued'
                    CHECK (processing_status IN ('queued','processed','failed')),
  error_message     TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_webhook_provider_event
  ON loyalty_webhook_events(provider, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_webhook_status_received
  ON loyalty_webhook_events (processing_status, received_at);

CREATE TABLE IF NOT EXISTS loyalty_outreach_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('email','sms','wallet_pass')),
  template_key      TEXT NOT NULL,
  dedupe_key        TEXT,
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','failed','skipped')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at           TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_outreach_sched
  ON loyalty_outreach_queue (status, next_attempt_at);

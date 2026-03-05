-- Event-plane idempotency: one row per (event_id, consumer_group).
-- Consumers use this to process each event once per group (or track retries/dead).
CREATE TABLE IF NOT EXISTS event_receipts (
  event_id         UUID NOT NULL,
  consumer_group   TEXT NOT NULL,
  stream           TEXT NOT NULL,
  consumer_name    TEXT,
  event_type       TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  payload_hash     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'dead', 'skipped')),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deliveries       INT NOT NULL DEFAULT 1,
  last_error       TEXT,
  PRIMARY KEY (event_id, consumer_group)
);

CREATE INDEX IF NOT EXISTS idx_event_receipts_stream_group_status
  ON event_receipts (stream, consumer_group, status);
CREATE INDEX IF NOT EXISTS idx_event_receipts_idempotency_group
  ON event_receipts (idempotency_key, consumer_group);

-- Optional: strict semantic dedupe per group (e.g. one per customer per window).
-- Uncomment if you want to enforce UNIQUE (consumer_group, idempotency_key):
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_event_receipts_group_idempotency
--   ON event_receipts (consumer_group, idempotency_key);

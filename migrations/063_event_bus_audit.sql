-- Optional audit table for events.domain consumer (mediated swarm).
-- Scripts/events-domain-consumer.js writes here when EVENTS_AUDIT_TO_PG=true.
CREATE TABLE IF NOT EXISTS event_bus_audit (
  id            BIGSERIAL PRIMARY KEY,
  stream_key    TEXT NOT NULL,
  stream_id     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  domain        TEXT,
  payload_json  JSONB,
  occurred_at   TIMESTAMPTZ,
  seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stream_key, stream_id)
);

CREATE INDEX IF NOT EXISTS idx_event_bus_audit_seen_at
  ON event_bus_audit (seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_bus_audit_event_type
  ON event_bus_audit (event_type, seen_at DESC);

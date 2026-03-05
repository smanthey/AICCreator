-- 048_loyalty_event_spine.sql
-- Adds normalized webhook metadata, order lifecycle persistence, and domain event routing spine.

ALTER TABLE loyalty_webhook_events
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS event_version TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS loyalty_order_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id    UUID REFERENCES loyalty_webhook_events(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  source_system       TEXT,
  event_id            TEXT,
  event_type          TEXT NOT NULL,
  event_version       TEXT,
  schema_version      TEXT,
  order_id            TEXT,
  order_status        TEXT,
  store_id            TEXT,
  customer_external_id TEXT,
  customer_loyalty_id TEXT,
  customer_email      TEXT,
  customer_phone      TEXT,
  subtotal_cents      INTEGER,
  discount_cents      INTEGER,
  tax_cents           INTEGER,
  total_cents         INTEGER,
  currency_code       TEXT,
  payload_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_order_events_event_time
  ON loyalty_order_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_order_events_order_id
  ON loyalty_order_events (order_id);

CREATE TABLE IF NOT EXISTS loyalty_order_line_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_event_id      UUID NOT NULL REFERENCES loyalty_order_events(id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL DEFAULT 1,
  sku                 TEXT,
  product_id          TEXT,
  product_name        TEXT,
  category            TEXT,
  brand               TEXT,
  quantity            NUMERIC(12, 3),
  unit_price_cents    INTEGER,
  discount_cents      INTEGER,
  tax_cents           INTEGER,
  line_total_cents    INTEGER,
  payload_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_order_line_items_event
  ON loyalty_order_line_items (order_event_id, line_no);

CREATE INDEX IF NOT EXISTS idx_loyalty_order_line_items_sku
  ON loyalty_order_line_items (sku);

CREATE TABLE IF NOT EXISTS loyalty_domain_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              TEXT NOT NULL,
  source_system         TEXT,
  source_webhook_event_id UUID REFERENCES loyalty_webhook_events(id) ON DELETE SET NULL,
  source_order_event_id UUID REFERENCES loyalty_order_events(id) ON DELETE SET NULL,
  source_event_id       TEXT,
  source_event_type     TEXT,
  domain_event_type     TEXT NOT NULL,
  domain_event_key      TEXT NOT NULL UNIQUE,
  payload_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_domain_events_type_time
  ON loyalty_domain_events (domain_event_type, occurred_at DESC);

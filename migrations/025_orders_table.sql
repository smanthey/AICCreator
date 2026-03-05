-- Migration 025: Stripe orders table
-- ─────────────────────────────────────────────────────────────────────────────
-- Stores completed wholesale orders from Stripe checkout sessions.
-- Also created dynamically by stripe-webhook-handler.js on first event,
-- but running this migration ensures it's ready before the first webhook.

CREATE TABLE IF NOT EXISTS orders (
  id                    SERIAL PRIMARY KEY,
  stripe_session_id     TEXT UNIQUE NOT NULL,
  stripe_payment_intent TEXT,
  buyer_name            TEXT,
  buyer_email           TEXT,
  buyer_phone           TEXT,
  shipping_address      TEXT,
  amount_total          INTEGER,          -- cents
  currency              TEXT DEFAULT 'usd',
  items_json            JSONB,
  status                TEXT DEFAULT 'confirmed',  -- confirmed | payment_failed | refunded | shipped | complete
  buyer_emailed         BOOLEAN DEFAULT FALSE,
  admin_emailed         BOOLEAN DEFAULT FALSE,
  shipped_at            TIMESTAMP,
  shippo_tracking       TEXT,             -- Shippo tracking ID if using Shippo
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_stripe_session    ON orders (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment    ON orders (stripe_payment_intent);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_email       ON orders (buyer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status            ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created           ON orders (created_at DESC);

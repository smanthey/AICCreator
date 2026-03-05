-- Rules-first selling pipeline core (one-off + repeat SKU modes)

ALTER TABLE sell_items
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'one_off'
    CHECK (mode IN ('one_off', 'repeat_sku')),
  ADD COLUMN IF NOT EXISTS price_policy TEXT NOT NULL DEFAULT 'normal'
    CHECK (price_policy IN ('liquidate', 'normal', 'max_margin')),
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS channel_recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS foreman_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (foreman_status IN ('pending', 'approve', 'needs_info', 'blocked')),
  ADD COLUMN IF NOT EXISTS next_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_title TEXT,
  ADD COLUMN IF NOT EXISTS list_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS sell_pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES sell_items(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','failed','skipped')),
  detail TEXT,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sell_pipeline_runs_item_created
  ON sell_pipeline_runs(item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sell_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES sell_items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  specifics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  listing_packet_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready_for_approval','published','sold','closed')),
  external_listing_id TEXT,
  external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sell_listings_item_channel
  ON sell_listings(item_id, channel);


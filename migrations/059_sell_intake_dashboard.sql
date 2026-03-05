-- Selling system intake tables (dashboard + upload link workflow)

CREATE TABLE IF NOT EXISTS sell_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,
  title TEXT,
  notes TEXT,
  desired_velocity TEXT NOT NULL DEFAULT 'normal'
    CHECK (desired_velocity IN ('fast', 'normal', 'max')),
  preferred_channels TEXT[] NOT NULL DEFAULT ARRAY['ebay']::TEXT[],
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN (
      'NEW',
      'INGESTED',
      'EXTRACTED',
      'IDENTIFIED',
      'NEEDS_ID_INFO',
      'ENRICHED',
      'NEEDS_ENRICH_INFO',
      'PRICED',
      'NEEDS_PRICE_INPUT',
      'LISTING_DRAFTED',
      'NEEDS_LISTING_INFO',
      'READY_FOR_APPROVAL',
      'PUBLISHED',
      'SOLD',
      'SHIPPED',
      'CLOSED',
      'QUARANTINED'
    )),
  extraction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  listing_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sell_items_status_created
  ON sell_items(status, created_at DESC);

CREATE TABLE IF NOT EXISTS sell_item_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES sell_items(id) ON DELETE CASCADE,
  role TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sell_item_media_item
  ON sell_item_media(item_id, created_at ASC);


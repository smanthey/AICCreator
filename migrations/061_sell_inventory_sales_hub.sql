-- Sales hub extensions: item-first counted inventory + queue support

ALTER TABLE sell_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'SMATdesigns',
  ADD COLUMN IF NOT EXISTS sub_brand TEXT,
  ADD COLUMN IF NOT EXISTS location_code TEXT,
  ADD COLUMN IF NOT EXISTS qty_estimated INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_confirmed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_reserved INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  ADD COLUMN IF NOT EXISTS stale_since TIMESTAMPTZ;

ALTER TABLE sell_listings
  ADD COLUMN IF NOT EXISTS quantity_posted INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS watchers_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sell_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES sell_items(id) ON DELETE CASCADE,
  sell_order_id UUID,
  qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','released','fulfilled','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sell_reservations_item_status
  ON sell_reservations(item_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sell_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  remote_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','paid','cancelled','fulfilled','closed')),
  buyer_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  totals_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sell_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sell_order_id UUID NOT NULL REFERENCES sell_orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES sell_items(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12,2),
  title_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sell_order_lines_item
  ON sell_order_lines(item_id, created_at DESC);


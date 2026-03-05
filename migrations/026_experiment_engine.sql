-- Migration 026: Self-Optimizing Experiment Engine Tables (Postgres)
-- Multi-armed bandit outbound system.
-- Revenue per 100 sends is the primary KPI.

CREATE TABLE IF NOT EXISTS email_variants (
  id              TEXT PRIMARY KEY,
  component       TEXT NOT NULL,
  label           TEXT NOT NULL,
  content         TEXT NOT NULL,
  weight          NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at       TIMESTAMPTZ,
  pause_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_variants_component ON email_variants(component, active);

CREATE TABLE IF NOT EXISTS variant_stats (
  variant_id        TEXT PRIMARY KEY REFERENCES email_variants(id) ON DELETE CASCADE,
  sends             INTEGER NOT NULL DEFAULT 0,
  opens             INTEGER NOT NULL DEFAULT 0,
  clicks            INTEGER NOT NULL DEFAULT 0,
  replies           INTEGER NOT NULL DEFAULT 0,
  positive_replies  INTEGER NOT NULL DEFAULT 0,
  orders            INTEGER NOT NULL DEFAULT 0,
  revenue_cents     BIGINT NOT NULL DEFAULT 0,
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_send_log (
  id                 BIGSERIAL PRIMARY KEY,
  lead_id            UUID REFERENCES leads(id),
  subject_id         TEXT,
  hook_id            TEXT,
  cta_id             TEXT,
  image_id           TEXT,
  offer_id           TEXT,
  segment            TEXT,
  is_explore         BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at          TIMESTAMPTZ,
  clicked_at         TIMESTAMPTZ,
  replied_at         TIMESTAMPTZ,
  reply_positive     BOOLEAN NOT NULL DEFAULT FALSE,
  order_id           TEXT,
  order_value_cents  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_send_log_lead    ON email_send_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_send_log_subject ON email_send_log(subject_id);
CREATE INDEX IF NOT EXISTS idx_send_log_hook    ON email_send_log(hook_id);
CREATE INDEX IF NOT EXISTS idx_send_log_offer   ON email_send_log(offer_id);
CREATE INDEX IF NOT EXISTS idx_send_log_order   ON email_send_log(order_id);

CREATE TABLE IF NOT EXISTS segment_variant_stats (
  segment         TEXT NOT NULL,
  variant_id      TEXT NOT NULL REFERENCES email_variants(id) ON DELETE CASCADE,
  sends           INTEGER NOT NULL DEFAULT 0,
  revenue_cents   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (segment, variant_id)
);

CREATE TABLE IF NOT EXISTS experiment_log (
  id              BIGSERIAL PRIMARY KEY,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action          TEXT NOT NULL,
  variant_id      TEXT,
  old_weight      NUMERIC(10,4),
  new_weight      NUMERIC(10,4),
  reason          TEXT,
  reward_score    NUMERIC(14,4)
);

INSERT INTO email_variants (id, component, label, content) VALUES
  ('subject_margin',    'subject', 'Margin angle',         'Health stores seeing 65% margin on this'),
  ('subject_question',  'subject', 'Soft question',        'Quick question about your supplement shelf'),
  ('subject_wholesale', 'subject', 'Wholesale direct',     'Wholesale opportunity for {{store_name}}'),
  ('subject_sellthru',  'subject', 'Sell-through speed',   'High sell-through — stores reorder within 21 days'),
  ('subject_patch',     'subject', 'Category specific',    'The wellness patch your customers are already searching for')
ON CONFLICT (id) DO NOTHING;

INSERT INTO variant_stats (variant_id) VALUES
  ('subject_margin'), ('subject_question'), ('subject_wholesale'),
  ('subject_sellthru'), ('subject_patch')
ON CONFLICT (variant_id) DO NOTHING;

INSERT INTO email_variants (id, component, label, content) VALUES
  ('hook_margin',   'hook', 'Margin angle',       'Most health stores see 60-70% margins on SkynPatch. It''s one of the highest-margin categories on the shelf.'),
  ('hook_sellthru', 'hook', 'Sell-through speed', 'SkynPatch moves fast — average stores reorder within 21 days of their first case.'),
  ('hook_diff',     'hook', 'Differentiation',    'Your customers are already buying wellness patches online. SkynPatch lets you capture that spend in-store.'),
  ('hook_loss',     'hook', 'Loss avoidance',     'Independent stores that pass on topical wellness are watching that category go to Amazon. We help you capture that spend in-store.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO variant_stats (variant_id) VALUES
  ('hook_margin'), ('hook_sellthru'), ('hook_diff'), ('hook_loss')
ON CONFLICT (variant_id) DO NOTHING;

INSERT INTO email_variants (id, component, label, content) VALUES
  ('cta_reply_yes',  'cta', 'Reply YES',           'Reply YES and I''ll send the wholesale sheet.'),
  ('cta_see_sheet',  'cta', 'See wholesale sheet', 'See the full wholesale sheet and pricing here: {{sales_sheet_url}}'),
  ('cta_order_case', 'cta', 'Order starter case',  'Order a starter case ({{starter_qty}} units) here: {{checkout_url}}'),
  ('cta_sample',     'cta', 'Start with sample',   'Want to start with a sample first? Hit reply.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO variant_stats (variant_id) VALUES
  ('cta_reply_yes'), ('cta_see_sheet'), ('cta_order_case'), ('cta_sample')
ON CONFLICT (variant_id) DO NOTHING;

INSERT INTO email_variants (id, component, label, content) VALUES
  ('offer_single_250', 'offer', 'Single case $250',        'single_250'),
  ('offer_bundle_900', 'offer', 'Bundle all-4 $900',       'bundle_900'),
  ('offer_bundle_799', 'offer', 'Bundle intro $799',       'bundle_799'),
  ('offer_bundle_699', 'offer', 'Bundle launch $699',      'bundle_699'),
  ('offer_free_ship',  'offer', 'Free shipping on bundle', 'free_shipping')
ON CONFLICT (id) DO NOTHING;

INSERT INTO variant_stats (variant_id) VALUES
  ('offer_single_250'), ('offer_bundle_900'), ('offer_bundle_799'),
  ('offer_bundle_699'), ('offer_free_ship')
ON CONFLICT (variant_id) DO NOTHING;

INSERT INTO email_variants (id, component, label, content) VALUES
  ('image_none',      'image', 'No image (control)',   'none'),
  ('image_product',   'image', 'Product hero',         'product_hero'),
  ('image_margin',    'image', 'Margin table graphic', 'margin_table'),
  ('image_lifestyle', 'image', 'Lifestyle photo',      'lifestyle')
ON CONFLICT (id) DO NOTHING;

INSERT INTO variant_stats (variant_id) VALUES
  ('image_none'), ('image_product'), ('image_margin'), ('image_lifestyle')
ON CONFLICT (variant_id) DO NOTHING;

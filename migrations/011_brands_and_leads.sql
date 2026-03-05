-- migrations/011_brands_and_leads.sql
-- Brand config, content research, lead generation, outbound email, and managed repos.

-- ── Brand definitions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  niche       TEXT,
  website     TEXT,
  instagram   TEXT,
  tiktok      TEXT,
  description TEXT,
  target_demo TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Competitor / reference accounts per brand ─────────────────
CREATE TABLE IF NOT EXISTS brand_competitors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_slug  TEXT NOT NULL REFERENCES brands(slug),
  platform    TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube')),
  handle      TEXT NOT NULL,
  url         TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_slug, platform, handle)
);

-- ── Raw content items from scrapers ──────────────────────────
CREATE TABLE IF NOT EXISTS content_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_slug  TEXT,
  source      TEXT NOT NULL,   -- 'tiktok', 'instagram', 'youtube'
  handle      TEXT,
  post_id     TEXT UNIQUE,
  url         TEXT,
  caption     TEXT,
  likes       BIGINT,
  comments    BIGINT,
  shares      BIGINT,
  views       BIGINT,
  posted_at   TIMESTAMPTZ,
  raw_data    JSONB,
  fetched_at  TIMESTAMPTZ DEFAULT now(),
  plan_id     UUID,
  task_id     UUID
);

-- ── AI-generated content briefs ───────────────────────────────
CREATE TABLE IF NOT EXISTS content_briefs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_slug     TEXT NOT NULL,
  title          TEXT,
  hook_pattern   TEXT,
  script_outline TEXT,
  pacing_notes   TEXT,
  cta            TEXT,
  platform       TEXT,
  content_type   TEXT,
  confidence     FLOAT,
  raw_analysis   JSONB,
  source_items   UUID[],
  created_at     TIMESTAMPTZ DEFAULT now(),
  plan_id        UUID,
  task_id        UUID
);

-- ── Lead pool (Google Places) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_slug    TEXT NOT NULL,
  business_name TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  phone         TEXT,
  website       TEXT,
  category      TEXT,
  place_id      TEXT UNIQUE,
  email         TEXT,
  status        TEXT DEFAULT 'new',
  notes         TEXT,
  raw_data      JSONB,
  fetched_at    TIMESTAMPTZ DEFAULT now(),
  plan_id       UUID,
  task_id       UUID
);

-- ── Outbound email log (CAN-SPAM compliance) ──────────────────
CREATE TABLE IF NOT EXISTS email_sends (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES leads(id),
  brand_slug   TEXT,
  to_email     TEXT NOT NULL,
  to_name      TEXT,
  subject      TEXT,
  template     TEXT,
  maileroo_id  TEXT,
  status       TEXT DEFAULT 'sent',
  sent_at      TIMESTAMPTZ DEFAULT now(),
  plan_id      UUID,
  task_id      UUID
);

-- ── Design firm client repos ──────────────────────────────────
CREATE TABLE IF NOT EXISTS managed_repos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name  TEXT,
  repo_url     TEXT UNIQUE NOT NULL,
  local_path   TEXT,
  branch       TEXT DEFAULT 'main',
  last_synced  TIMESTAMPTZ,
  last_commit  TEXT,
  status       TEXT DEFAULT 'active',
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── Seed: Skyn Patch brand ────────────────────────────────────
INSERT INTO brands (slug, name, niche, website, instagram, tiktok, description, target_demo)
VALUES
  (
    'skynpatch',
    'Skyn Patch',
    'wellness / vitamin patches',
    'https://skynpatch.com',
    '@skynpatch',
    '@skynpatch',
    'Transdermal vitamin & wellness patches for energy, sleep, and metabolism. 4x better absorption than pills, 8-12hr sustained release, FDA-registered manufacturing.',
    'Health-conscious adults 25-45, biohackers, fitness enthusiasts, busy professionals'
  ),
  (
    'plushtrap',
    'Plush Trap',
    'streetwear accessories & collectibles',
    'https://plushtrap.com',
    '@plushtrap',
    '@plushtrap',
    'Retro-urban streetwear & collectibles. Hand-crafted plushies, hats, masks, bags, beanies. Gaming + skate culture, 3D-designed limited-edition drops.',
    'Gen Z / millennial streetwear fans 18-32, gamers, collectors, skate culture enthusiasts'
  )
ON CONFLICT (slug) DO NOTHING;

-- ── Seed: Skyn Patch competitors ─────────────────────────────
INSERT INTO brand_competitors (brand_slug, platform, handle, url, notes)
VALUES
  ('skynpatch','instagram','thepatchbrand','https://instagram.com/thepatchbrand','26K followers, retail at Walgreens/7-Eleven/Kohls — top benchmark'),
  ('skynpatch','instagram','patchmd','https://instagram.com/patchmd','PatchMD — large vitamin patch catalogue'),
  ('skynpatch','instagram','thepatchremedy','https://instagram.com/thepatchremedy','The Patch Remedy — wellness-focused'),
  ('skynpatch','tiktok','thepatchbrand','https://tiktok.com/@thepatchbrand','Patch Brand TikTok'),
  ('skynpatch','youtube','thepatchbrand','https://youtube.com/@thepatchbrand','Educational + product content'),

-- ── Seed: Plush Trap competitors ─────────────────────────────
  ('plushtrap','instagram','trapstar','https://instagram.com/trapstar','Trapstar UK — streetwear with accessories, strong organic drops'),
  ('plushtrap','instagram','corteizclothing','https://instagram.com/corteizclothing','Corteiz — viral limited drops, Gen Z streetwear'),
  ('plushtrap','instagram','palaceskateboards','https://instagram.com/palaceskateboards','Palace — accessories/hat focus, skate culture'),
  ('plushtrap','instagram','stussy','https://instagram.com/stussy','Stussy — OG streetwear aesthetic reference'),
  ('plushtrap','tiktok','corteizclothing','https://tiktok.com/@corteizclothing','Corteiz TikTok — viral drop storytelling'),
  ('plushtrap','tiktok','trapstarlondon','https://tiktok.com/@trapstarlondon','Trapstar TikTok organic content'),
  ('plushtrap','youtube','corteiz','https://youtube.com/@corteiz','Corteiz YouTube — drop hype and behind-the-scenes')
ON CONFLICT (brand_slug, platform, handle) DO NOTHING;

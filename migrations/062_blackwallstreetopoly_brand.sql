-- migrations/062_blackwallstreetopoly_brand.sql
-- Add Black Wall Street Monopoly brand for toy store / boutique / HBCU wholesale lead gen.

-- brand_email: set via UPDATE after provisioning Maileroo; or use MAILEROO_FROM_EMAIL env
INSERT INTO brands (slug, name, niche, website, instagram, tiktok, description, target_demo, from_name, brand_email)
VALUES
  (
    'blackwallstreetopoly',
    'Black Wall Street Monopoly',
    'board games / educational toys',
    'https://www.etsy.com/shop/BlackWallStreetopoly',
    '@blackwallstreetopoly',
    '@blackwallstreetopoly',
    'Educational board game celebrating Black Wall Street and entrepreneurship. Teaches financial literacy, history, and Black economic legacy. Etsy bestseller.',
    'Toy stores, Black-owned boutiques, HBCU campus stores, gift shops, educational retailers',
    'Scott',
    NULL  -- set via UPDATE brands SET brand_email='...' after provisioning
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  niche = EXCLUDED.niche,
  website = EXCLUDED.website,
  description = EXCLUDED.description,
  target_demo = EXCLUDED.target_demo,
  from_name = COALESCE(brands.from_name, EXCLUDED.from_name),
  brand_email = COALESCE(brands.brand_email, EXCLUDED.brand_email);

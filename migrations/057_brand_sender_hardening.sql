-- 057_brand_sender_hardening.sql
-- Enforce sane sender defaults for production outbound.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS from_name   TEXT,
  ADD COLUMN IF NOT EXISTS brand_email TEXT;

UPDATE brands
SET
  from_name = COALESCE(from_name, 'Scott'),
  brand_email = CASE
    WHEN slug = 'skynpatch' THEN 'shop@skynpatch.com'
    ELSE COALESCE(brand_email, NULL)
  END
WHERE slug = 'skynpatch'
   OR from_name IS NULL;


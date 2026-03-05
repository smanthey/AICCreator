-- 045_brand_cookies_nirvana_canonical.sql
-- Canonicalize legacy Cookies pass brand labels for go-live routing.
-- Required mapping:
--   CookiesPass copy  -> cookies
--   CookiesPass other -> nirvana

-- file_index legacy values
UPDATE file_index
SET brand = 'cookies'
WHERE brand = 'cookies_tempe';

UPDATE file_index
SET brand = 'nirvana'
WHERE brand = 'cookies_nirvana';

-- claw_files legacy values (if table/column exists from older flows)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'claw_files'
      AND column_name = 'brand'
  ) THEN
    EXECUTE $sql$UPDATE claw_files SET brand = 'cookies' WHERE brand = 'cookies_tempe'$sql$;
    EXECUTE $sql$UPDATE claw_files SET brand = 'nirvana' WHERE brand = 'cookies_nirvana'$sql$;
  END IF;
END $$;

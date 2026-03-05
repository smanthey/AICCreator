-- Migration 021: Fix CookiesPass brand split, add ariel + 3dgameartacademy
-- ─────────────────────────────────────────────────────────────────────────────
-- CookiesPass-1 copy = Tempe Cookies dispensary wallet pass
-- CookiesPass-1      = Nirvana Cookies dispensary wallet pass
-- These are NOT duplicates — same structure, different client locations.

-- 1. Brand the Tempe version first (path contains "copy")
UPDATE files
SET brand = 'cookies_tempe'
WHERE brand IS NULL
  AND (path ~* 'CookiesPass.*copy' OR path ~* 'cookies.*tempe' OR path ~* 'tempe.*cookies');

-- 2. Brand the Nirvana version (remaining CookiesPass, not tempe)
UPDATE files
SET brand = 'cookies_nirvana'
WHERE brand IS NULL
  AND path ~* 'CookiesPass'
  AND path !~* 'tempe';

-- 3. Also fix any rows already branded just 'cookies' that should be split
UPDATE files
SET brand = 'cookies_tempe'
WHERE brand = 'cookies'
  AND (path ~* 'CookiesPass.*copy' OR path ~* 'tempe');

UPDATE files
SET brand = 'cookies_nirvana'
WHERE brand = 'cookies'
  AND path ~* 'CookiesPass'
  AND path !~* 'tempe'
  AND path !~* 'copy';

-- 4. Ariel's Blender asset library
UPDATE files
SET brand = 'ariel'
WHERE brand IS NULL
  AND (path ~* 'blenderkit_data' OR path ~* '/ariel/');

-- 5. 3D Game Art Academy (website client project)
UPDATE files
SET brand = '3dgameartacademy'
WHERE brand IS NULL
  AND path ~* '3DGameArtAcademy';

-- 6. System/cache folders — mark category so they stop polluting unbranded counts
-- These are app data, not project files. Set category but leave brand NULL intentionally.
UPDATE files
SET category = 'cache', category_reason = 'system_folder'
WHERE brand IS NULL
  AND category IS NULL
  AND (
    path ~* '^/Users/[^/]+/\.config/'    OR
    path ~* '^/Users/[^/]+/\.cursor/'    OR
    path ~* '^/Users/[^/]+/\.codex/'     OR
    path ~* '^/Users/[^/]+/\.thumbnails/' OR
    path ~* '^/Users/[^/]+/\.cache/'
  );

-- 7. Mark the CookiesPass duplicate_groups as false positives
-- (same structure, different client — dedup should not flag these for deletion)
UPDATE duplicate_groups dg
SET resolution = 'review',
    status     = 'probable'
WHERE EXISTS (
  SELECT 1 FROM files f
  WHERE f.id = dg.canonical_file_id
    AND (f.path ~* 'CookiesPass' OR f.brand IN ('cookies_nirvana','cookies_tempe','cookies'))
);

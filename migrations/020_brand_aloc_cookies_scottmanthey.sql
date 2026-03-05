-- Migration 020: Add aloc, cookies, scottmanthey brands
-- Backfills brand IS NULL rows with newly identified brand patterns.
-- Also backfills any github-indexed rows where path contains 'scottmanthey'.

UPDATE files
SET brand = CASE
  WHEN path ~* '/aloc/'                           THEN 'aloc'
  WHEN path ~* '/cookies/'                        THEN 'cookies'
  WHEN path ~* 'scottmanthey'                     THEN 'smat'
END
WHERE brand IS NULL
  AND (
    path ~* '/aloc/'      OR
    path ~* '/cookies/'   OR
    path ~* 'scottmanthey'
  );

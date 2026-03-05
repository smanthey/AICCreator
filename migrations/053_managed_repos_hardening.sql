-- Migration 053: managed_repos hardening
-- - normalize GitHub HTTPS URLs to SSH alias (github-claw)
-- - dedupe rows that normalize to same repo URL
-- - dedupe rows sharing active client_name + local_path
-- - enforce active uniqueness for client_name + local_path

-- 1) Deduplicate rows that represent the same GitHub repo after URL normalization.
WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN repo_url LIKE 'https://github.com/%' THEN
        regexp_replace(regexp_replace(repo_url, '^https://github\\.com/', 'git@github-claw:'), '\\.(git)$', '') || '.git'
      ELSE repo_url
    END AS norm_url,
    status,
    created_at,
    row_number() OVER (
      PARTITION BY
        CASE
          WHEN repo_url LIKE 'https://github.com/%' THEN regexp_replace(regexp_replace(repo_url, '^https://github\\.com/', 'git@github-claw:'), '\\.(git)$', '') || '.git'
          ELSE repo_url
        END
      ORDER BY (CASE WHEN status='active' THEN 0 ELSE 1 END), created_at DESC, id DESC
    ) AS rn
  FROM managed_repos
)
DELETE FROM managed_repos mr
USING normalized n
WHERE mr.id = n.id
  AND n.rn > 1;

-- 2) Normalize remaining GitHub HTTPS URLs to SSH alias.
UPDATE managed_repos
SET repo_url = regexp_replace(regexp_replace(repo_url, '^https://github\\.com/', 'git@github-claw:'), '\\.(git)$', '') || '.git'
WHERE repo_url LIKE 'https://github.com/%';

-- 3) Deduplicate active rows by client_name + local_path (case-insensitive name).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(client_name), local_path
      ORDER BY (CASE WHEN status='active' THEN 0 ELSE 1 END), created_at DESC, id DESC
    ) AS rn
  FROM managed_repos
)
DELETE FROM managed_repos mr
USING ranked r
WHERE mr.id = r.id
  AND r.rn > 1;

-- 4) Prevent regressions for active repos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_managed_repos_active_client_path
  ON managed_repos (lower(client_name), local_path)
  WHERE status = 'active';

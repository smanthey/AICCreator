-- Migration 054: fix malformed managed_repos URLs (e.g. https://...git.git)

-- Normalize any GitHub HTTPS URL to SSH alias and collapse trailing .git/.git.git.
UPDATE managed_repos
SET repo_url =
  regexp_replace(
    regexp_replace(
      regexp_replace(repo_url, '^https://github[.]com/', 'git@github-claw:'),
      '([.]git)+$',
      ''
    ),
    '$',
    '.git'
  )
WHERE repo_url LIKE 'https://github.com/%';

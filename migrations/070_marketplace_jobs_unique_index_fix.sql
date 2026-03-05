-- 070_marketplace_jobs_unique_index_fix.sql
-- Ensure ON CONFLICT (marketplace, external_job_id) is valid for marketplace_jobs

DROP INDEX IF EXISTS ux_marketplace_jobs_source_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_marketplace_jobs_source_id
  ON marketplace_jobs(marketplace, external_job_id);

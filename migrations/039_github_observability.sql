-- Migration 039: GitHub observability scan tables (deterministic stack/pattern analysis)

CREATE TABLE IF NOT EXISTS github_repo_scan_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running', -- running|completed|failed
  repos_total  INTEGER NOT NULL DEFAULT 0,
  repos_scanned INTEGER NOT NULL DEFAULT 0,
  pass_count   INTEGER NOT NULL DEFAULT 0,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  notes        JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS github_repo_stack_facts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 UUID NOT NULL REFERENCES github_repo_scan_runs(id) ON DELETE CASCADE,
  repo_id                UUID REFERENCES managed_repos(id) ON DELETE SET NULL,
  repo_name              TEXT,
  local_path             TEXT NOT NULL,
  commit_sha             TEXT,
  branch                 TEXT,
  framework              TEXT,
  next_version           TEXT,
  router_mode            TEXT, -- app|pages|mixed|none
  node_version           TEXT,
  orm_used               TEXT,
  db_client              TEXT,
  auth_provider          TEXT,
  billing_pattern        TEXT,
  telnyx_pattern         TEXT,
  email_provider         TEXT,
  deployment_target      TEXT,
  has_playwright         BOOLEAN NOT NULL DEFAULT false,
  has_module_manifests   BOOLEAN NOT NULL DEFAULT false,
  module_manifest_count  INTEGER NOT NULL DEFAULT 0,
  webhook_signature_verified BOOLEAN NOT NULL DEFAULT false,
  stripe_idempotency_used BOOLEAN NOT NULL DEFAULT false,
  org_model_detected     BOOLEAN NOT NULL DEFAULT false,
  rbac_present           BOOLEAN NOT NULL DEFAULT false,
  rls_present            BOOLEAN NOT NULL DEFAULT false,
  multi_tenant_score     NUMERIC(4,3) NOT NULL DEFAULT 0,
  stack_health_score     INTEGER NOT NULL DEFAULT 0,
  pattern_hash           TEXT NOT NULL,
  findings               JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_repo_stack_facts_run ON github_repo_stack_facts(run_id);
CREATE INDEX IF NOT EXISTS idx_github_repo_stack_facts_repo ON github_repo_stack_facts(repo_id);
CREATE INDEX IF NOT EXISTS idx_github_repo_stack_facts_hash ON github_repo_stack_facts(pattern_hash);

CREATE TABLE IF NOT EXISTS github_repo_violations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES github_repo_scan_runs(id) ON DELETE CASCADE,
  repo_id     UUID REFERENCES managed_repos(id) ON DELETE SET NULL,
  repo_name   TEXT,
  severity    TEXT NOT NULL, -- info|warn|critical
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  evidence    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_repo_violations_run ON github_repo_violations(run_id, severity);

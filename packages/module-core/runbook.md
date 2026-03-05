# Module Core Runbook

Purpose: baseline module metadata for platform scans and deterministic health checks.

Checks:
- Verify required Postgres env vars are set.
- Verify `/api/healthz` route exists in consuming app.
- Verify `core-smoke` Playwright pack is present.

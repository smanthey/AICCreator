# Four-Repo Release Checklist (CaptureInbound, PayClaw, TempeCookiesPass, QuantFusion)

This checklist tracks the highest-priority completion pass and provides a known-good startup order.

## Scope

- CaptureInbound
- payclaw
- TempeCookiesPass
- quantfusion

## What was finalized

### CaptureInbound

- Tenant/number mismatch diagnostics endpoint: `GET /api/admin/tenant-number-integrity`
- Tenant/number repair endpoint: `POST /api/admin/tenant-number-integrity/repair`
- UI diagnostics panel in admin dashboard
- Safety guard in invitations/direct add to block cross-tenant user reassignment
- Runbook: `docs/TENANT-NUMBER-INTEGRITY-RUNBOOK.md`

### payclaw

- Stripe webhook dedupe helper integrated
- Removed legacy duplicate webhook path file (`webhooks.ts`)
- Replay-safe tests added (`server/src/tests/webhook-dedup.test.ts`)

### TempeCookiesPass

- SMS schema verification script: `scripts/verify-sms-schema.ts`
- Live E2E SMS send script updated with optional webhook wait window
- Telnyx webhook confirmation script: `scripts/telnyx-webhook-confirmation-check.ts`
- Rollout/test commands added in `package.json`
- Runbook: `docs/SMS_PRODUCTION_ROLLOUT.md`

### quantfusion

- Historical collector persistence completed (writes to `historical_prices`)
- Conflict-safe historical writes in storage (`onConflict` handling)
- Unique constraint added for `symbol + interval + timestamp`
- Aggregated scanner health endpoint added: `GET /api/scanners/health`

## Known-good startup order

1. CaptureInbound
2. payclaw
3. TempeCookiesPass
4. quantfusion

Use:

```bash
npm run release:four-repos
```

To execute checks:

```bash
npm run release:four-repos:check
```

## Migration note

QuantFusion added a new uniqueness constraint in schema:

- `historical_prices_symbol_interval_timestamp_uniq`

Apply schema migration/push before production rollout in QuantFusion.

## Blockers expected without live env

The following checks are intentionally blocked in environments without production secrets:

- `TempeCookiesPass: npm run verify:sms-schema` (needs `DATABASE_URL`)
- `TempeCookiesPass: npm run test:telnyx:webhook-confirm` (needs Telnyx live envs)

## Runtime baseline (this host)

Use these guard checks before release work:

```bash
node scripts/agent-drift-audit.js
npm run pm2:check
node scripts/clawpay-taskmaster-checkfix.js
```

Expected result:

- `agent-drift-audit` returns `OK: no drift detected against required agent/runtime baseline.`
- `pm2:check` confirms critical processes running (`claw-architect-api`, `claw-dispatcher`, `claw-worker`, `claw-prompt-oracle`)
- `clawpay-taskmaster-checkfix` reports `all_required_online: true`

## Next TODO workflow (tracked completion gates)

Each lane is complete only when all gate checks pass.

### 1) CaptureInbound multitenant integrity hardening

- Ensure tenant/number mismatch auto-repair runs in dry-run then apply mode via scheduler.
- Gate checks:
  - `GET /api/admin/tenant-number-integrity` returns zero mismatches for active tenants
  - `POST /api/admin/tenant-number-integrity/repair` no-op on healthy state
  - UI diagnostics panel shows healthy tenant-number binding

### 2) PayClaw end-to-end payment + messaging integrity

- Keep webhook replay/dedupe hardening active and remove legacy paths.
- Gate checks:
  - webhook replay test suite passes (`server/src/tests/webhook-dedup.test.ts`)
  - Stripe onboarding -> checkout -> paid webhook round-trip updates invoice state exactly once
  - STOP/HELP Telnyx compliance path updates recipient suppression state

### 3) TempeCookiesPass production SMS release gate

- Run production SMS release sequence with env preflight.
- Gate checks:
  - schema verification passes
  - live send test returns provider message ID
  - webhook confirmation check resolves sent event within timeout window

### 4) QuantFusion real-data enforcement and persistence

- Ensure no simulation fallback in strict live mode.
- Gate checks:
  - strict env flags enabled (`STRICT_REAL_MONEY_MODE=true`, `OPENCLAW_REQUIRE_LIVE_TRADING=true`, `QUANT_REQUIRE_LIVE_DATA=true`)
  - scanner health endpoint reports live providers healthy
  - historical collector writes unique constrained rows without conflict regressions

### 5) Claw-Architect release coordination

- Keep cross-repo release checks executable from one command.
- Gate checks:
  - `npm run release:four-repos:check` is green (except explicitly documented live-env blockers)
  - known-good startup order and rollback notes are current in this doc

## Benchmarked OSS references used for this pass

These local mirrors were used as implementation references while hardening reliability paths:

- Telnyx SDK/reference flows: `/Users/tatsheen/claw-repos/_oss_refs/telnyx-node`
- Trigger.dev task/retry/scheduling patterns: `/Users/tatsheen/claw-repos/_oss_refs/trigger.dev`
- Queue/retry discipline patterns: `/Users/tatsheen/claw-repos/_oss_refs/pg-boss`
- Transactional email API/client patterns: `/Users/tatsheen/claw-repos/_oss_refs/resend-node`
- Multi-tenant notification orchestration patterns: `/Users/tatsheen/claw-repos/_oss_refs/novu`

# Integration Gaps Audit (Continuous Pass)

Date: 2026-03-03
Scope: PayClaw, CookiesPass (Tempe + nirvaan), QuantFusion
Method: jCodeMunch symbol index + route/API mapping + build/test validation

## PayClaw

### Newly fixed flow gaps
- Checkout completion now closes invoice loop:
  - Added `POST /webhooks/stripe` in [server.ts]($HOME/claw-repos/payclaw/server/src/server.ts)
  - Maps Stripe sessions back to invoices via `client_reference_id` and `metadata.invoiceId`
  - Sets invoice status to `paid`
- Failure lifecycle now wired:
  - Handles `checkout.session.expired` and `checkout.session.async_payment_failed`
  - Sets invoice `payment_failed` unless already `paid`
- Payment intent metadata now linked for stronger event correlation:
  - Added metadata invoice binding in [stripe.ts]($HOME/claw-repos/payclaw/server/src/stripe/stripe.ts)
- Telnyx webhook connected on main app server:
  - Added `POST /webhooks/telnyx` in [server.ts]($HOME/claw-repos/payclaw/server/src/server.ts)
  - Calls shared inbound handler for STOP/HELP
- Reminder engine no longer dead-ends after first touch:
  - Fixed status/query logic in [cli.ts]($HOME/claw-repos/payclaw/server/src/cli.ts)
  - Processor now reads `queued/pending/blocked_missing_setup`
  - Enforces deterministic 3-touch cadence (Day 0, Day 3, Day 7)
  - Marks missing setup as `blocked_missing_setup` and retries when setup is completed
- Onboarding now connects sender number:
  - Persists `telnyxNumber` from request or `TELNYX_FROM_NUMBER`
- Manual invoice API now enforces 45-day policy when `invoiceDate` is provided
- `PayClaw-Lite/server` synced with identical runtime fixes

### Validation
- `npm run check` (root) ✅
- `npm run mac:dmg` (root) ✅
- DMG output: `server/dist/PayClaw-1.0.0-arm64.dmg`

### Remaining non-blocking gaps
- Stripe webhook event idempotency table (dedupe by event ID) still not implemented
- Telnyx signature verification on Express webhook route (currently handled in standalone webhook server file)

## CookiesPass (Tempe parity uplift)

### Newly fixed unconnected systems in Tempe
- Added missing SMS UI page:
  - [AdminSMS.tsx]($HOME/claw-repos/TempeCookiesPass/client/src/pages/admin/AdminSMS.tsx)
- Wired admin route and sidebar navigation:
  - [AdminGate.tsx]($HOME/claw-repos/TempeCookiesPass/client/src/pages/admin/AdminGate.tsx)
  - [AdminLayout.tsx]($HOME/claw-repos/TempeCookiesPass/client/src/pages/admin/AdminLayout.tsx)
- Added Telnyx backend service:
  - [telnyx.ts]($HOME/claw-repos/TempeCookiesPass/server/services/telnyx.ts)
- Added SMS persistence tables in schema:
  - `sms_messages`, `sms_opt_outs` in [schema.ts]($HOME/claw-repos/TempeCookiesPass/shared/schema.ts)
- Added missing operational endpoints in Tempe routes:
  - `/api/cron/workflows`
  - `/api/cron/dutchie`
  - `/api/webhooks/telnyx`
  - `/api/admin/sms/*`
  - File: [routes.ts]($HOME/claw-repos/TempeCookiesPass/server/routes.ts)
- Added missing env vars documentation:
  - Telnyx + cron vars in [.env.example]($HOME/claw-repos/TempeCookiesPass/.env.example)

### Validation
- `npm run check` ✅
- `npm run build` ✅
- `npm run test` ✅ (live API suite intentionally skipped without running server)

### Remaining non-blocking gaps
- Need DB migration/push in deployment env for new SMS tables before production traffic

## QuantFusion

### Newly fixed flow gaps
- Mock-lab API safety gate added:
  - `/api/openclaw/mock/*` now requires `ENABLE_OPENCLAW_MOCK_LAB=true`
  - File: [routes.ts]($HOME/claw-repos/quantfusion/server/routes.ts)
- Scanner services now initialize on demand before reading signals:
  - politician/options/whale scanner `start()` orchestration added
- Scanner response transparency improved:
  - Added `integrationStatus` payload describing placeholder provider mode
- Frontend no longer hangs when mock lab is disabled:
  - Added explicit error-state rendering in [mock-trading-lab-panel.tsx]($HOME/claw-repos/quantfusion/client/src/components/mock-trading-lab-panel.tsx)

### Validation
- `npm run check` ✅
- `npm run build` ✅

### Remaining non-blocking gaps
- Politician/options/whale data fetchers still use placeholder sources in service layer

## Priority next pass
1. PayClaw: Stripe webhook event dedupe table + Telnyx signature verification on Express route.
2. CookiesPass: deploy migration for SMS tables and run live Telnyx end-to-end test.
3. Quant: replace placeholder scanner sources behind feature flags/API keys.

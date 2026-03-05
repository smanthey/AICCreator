# PayClaw Research Notes (2026-03-02)

## Next Wiring Options

- `A` Stripe onboarding from Electron: `Electron -> NAS -> Stripe Connect`
- `B` Checkout session creation from Electron: `Electron -> NAS -> Stripe Checkout -> Payment`
- `C` Stripe webhook updates SQLite in Electron: `Stripe -> NAS -> Electron API callback`
- `D` Telnyx SMS sending from Electron: `Electron -> NAS -> Telnyx`
- `E` Telnyx STOP compliance handling: `Telnyx -> NAS -> Electron DB update`

## API Endpoints To Expose

- `POST /connect/create-account-link`
- `POST /payments/create-checkout`
- `POST /sms/send`
- `POST /webhooks/stripe`

## Product Scope (Locked)

- macOS desktop app (DMG) for invoice payment collection via SMS/email.
- Not debt collection; invoice age must stay under 45 days.
- Users provide business info, recipients, invoice data, schedule preferences, and Stripe Connect.
- Telnyx + 10DLC + messaging guardrails controlled by platform.

## Compliance Guardrails

- Reject high-risk business types (collections, payday/title loans, gambling, adult, political, etc.).
- Require onboarding attestations:
  - existing business relationship
  - invoices under 45 days
  - not debt collection
  - STOP opt-out support
  - no purchased lists
- Enforce template-only SMS with required fields: business identity, invoice context, payment link, STOP/HELP.
- Enforce send controls:
  - quiet hours by timezone
  - hourly/daily caps per number
  - per-recipient touch limits
  - global opt-out registry
- Disable freeform blasting and arbitrary send-now behavior.

## Pricing Notes

- Base seat: `$25/mo` per number.
- Credit packs (example): `500`, `2,000`, `10,000`.
- Overage target: `$0.02-$0.03` per SMS depending on tier.
- Consider Stripe Connect application fee/take-rate for additional margin.

## Data Model Notes

- Core objects:
  - `CustomerAccount`
  - `StripeConnectAccount`
  - `MessagingNumber`
  - `Recipient`
  - `Invoice`
  - `MessagePlan`
  - `MessageSend`
  - `OptOut`
- Add scheduling lifecycle tables/fields for controlled cadence:
  - `invoice_jobs` with queue state
  - `message_schedule` with `send_at`, `attempt_number`, status

## UX Notes

- Onboarding sequence:
  - product scope + policy screen
  - business eligibility + attestations
  - Stripe connect
  - number assignment + billing
  - defaults (quiet hours, caps, tone)
- Main nav:
  - Dashboard
  - Campaigns
  - Invoices
  - Recipients
  - Messages (audit)
  - Settings
  - Support/Compliance
- Status colors:
  - green = paid
  - yellow = in-flight / not yet paid
  - red = aging/risk threshold

## Packaging Notes (macOS DMG)

- Use `electron-builder` for `.app` and `.dmg` packaging.
- Add Developer ID signing + notarization + stapling for smooth Gatekeeper install.
- `npm run mac:dmg` should produce final drag-and-drop DMG flow.

## Runtime Notes

- Ship an OpenClaw-lite deterministic runtime in desktop app:
  - schedule generator
  - sender worker
  - webhook listener
  - policy gate
- Avoid exposing full distributed orchestration on customer machines.

## Recommended Build Order

1. `A` Stripe onboarding from Electron.
2. `B` Checkout session creation.
3. `C` Stripe webhook reconciliation.
4. `E` STOP/HELP compliance end-to-end.
5. `D` SMS send path hardening + rate-limit gates.

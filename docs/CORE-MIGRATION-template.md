## Core Migration Template (Stripe / Email / Queue)

Use this template in each SaaS repo (PayClaw first, then others) when migrating to shared `core/*` modules from `claw-architect`.

Fill in the placeholders and commit as `docs/CORE-MIGRATION.md` in the target repo.

---

### 1. Scope

- **Repo**: `<repo-name>` (e.g. `PayClaw`)
- **Core modules adopted in this migration:**
  - `core/stripe` – centralized Stripe SDK usage, checkout, webhooks, subscription sync
  - `core/email` – unified transactional email sending via provider abstraction
  - `core/queue` – BullMQ/Redis queues, workers, and shared `withRetry`

---

### 2. Environment & Configuration

- **Stripe**
  - `STRIPE_SECRET_KEY` – secret key for this repo/site
  - `STRIPE_WEBHOOK_SECRET` – webhook signing secret for this repo/site
  - `COMMERCE_PUBLIC_URL` / `PUBLIC_URL` – base URL for redirects and webhook endpoints

- **Email**
  - `EMAIL_PROVIDER` – `brevo` (preferred), `resend`, or `maileroo`
  - `BREVO_API_KEY` – when Brevo is primary
  - `RESEND_API_KEY` – when Resend is primary or fallback
  - `MAILEROO_API_KEY` – legacy compatibility or fallback
  - `EMAIL_FALLBACK_ENABLED` – `"true"`/`"false"` (if both providers are configured)

- **Queue / Redis**
  - `REDIS_*` / connection settings reused from platform defaults

Document any repo‑specific overrides or additional env vars here.

---

### 3. Migration Flags

Introduce and document feature flags so you can cut over gradually:

- `CORE_STRIPE_ENABLED` – when `true`, all billing flows use `core/stripe`
- `CORE_EMAIL_ENABLED` – when `true`, all transactional email uses `core/email`
- `CORE_QUEUE_ENABLED` – when `true`, new background jobs use `core/queue`

For each flag, list:

- **Default** (dev/staging/prod)
- **Owning team/agent**
- **How to toggle** (config file, env var, or feature flag service)

---

### 4. Stripe Migration Checklist

**4.1 Discovery**

- [ ] MCP `search_text` for `stripe.` and `require("stripe")` in `<repo-name>`
- [ ] MCP `search_symbols` for `"webhook"`, `"checkout"`, `"subscription"` to locate:
  - Checkout creation
  - Webhook handlers
  - Subscription state management

Record key files/symbols:

- Checkout: `<file>`, `<symbol>`
- Webhook: `<file>`, `<symbol>`
- Subscriptions: `<file>`, `<symbol>`

**4.2 Adapters to `core/stripe`**

- [ ] Replace direct `checkout.sessions.create` calls with:
  - `core/stripe.createCheckoutSession(...)` wrapping repo‑specific metadata and URLs
- [ ] Replace webhook handlers’ direct Stripe usage with:
  - `core/stripe.handleStripeWebhook(rawBody, headers)` for verification + replay handling
  - Local dispatch that takes the normalized event and applies `<repo-name>` domain logic
- [ ] Replace subscription lookup / cancel calls with:
  - `getCustomerActiveSubscription(customerId)`
  - `cancelSubscription(subscriptionId, { cancelAtPeriodEnd })`

**4.3 Flags and Compatibility**

- [ ] Implement a Stripe integration layer that:
  - When `CORE_STRIPE_ENABLED=false` uses legacy Stripe code
  - When `CORE_STRIPE_ENABLED=true` uses `core/stripe`
- [ ] Ensure public controllers/routes keep the same external behavior in both modes

**4.4 Tests & Smoke**

- [ ] Unit/integration tests for:
  - Checkout creation (URLs, metadata, and prices)
  - Webhook handling for main event types (payment success/fail, subscription lifecycle)
- [ ] Optional: repo‑local CLI or script that exercises:
  - `createCheckoutSession`
  - A test webhook payload through the new handler

---

### 5. Email Migration Checklist

**5.1 Discovery**

- [ ] MCP `search_text` for `MailerSend`, `Maileroo`, `Resend`, `sendEmail` in `<repo-name>`
- [ ] List all modules that:
  - Send transactional email
  - Handle email/webhook events

**5.2 Route Sending via `core/email`**

- [ ] Introduce thin helpers for this repo, e.g.:
  - `send<Repo>ReceiptEmail(...)`
  - `send<Repo>OnboardingEmail(...)`
- [ ] Inside helpers, use:
  - `core/email.sendEmail({ to, subject, html, text, fromEmail, fromName, provider?, brand?, correlationId? })`
- [ ] Preserve existing brand details:
  - From email/name
  - Templates and content

**5.3 Flags and Rollout**

- [ ] Add `CORE_EMAIL_ENABLED` checks around existing email flows:
  - Old path: direct provider clients or legacy helpers
  - New path: `core/email`
- [ ] Start rollout with:
  - Lowest‑risk emails (internal alerts, test accounts)
  - Then move to high‑value customer emails (receipts, onboarding)

**5.4 Tests & Smoke**

- [ ] Add or update tests that assert:
  - `core/email` is called with the expected parameters
  - Provider selection and fallback behave as expected for this repo
- [ ] Optionally wire `scripts/email-core-smoke.js` (from `claw-architect`) or repo‑local equivalent:
  - Use `EMAIL_TEST_TO`, `EMAIL_TEST_FROM`, `EMAIL_TEST_PROVIDER`, `EMAIL_TEST_SUBJECT`

---

### 6. Queue / Retry Migration Checklist

**6.1 Discovery**

- [ ] MCP / Grep for:
  - `require("bullmq")`, `new Queue(`, `new Worker(`
  - Homegrown retry loops around network calls (Stripe, email, HTTP APIs)

List files/symbols that:

- Instantiate queues/workers
- Implement ad‑hoc retry

**6.2 Normalize on `core/queue`**

- [ ] For new or refactored background jobs:
  - Use `core/queue.createQueue(name)` instead of direct `new Queue(...)`
  - Use `core/queue.createWorker(name, handler, options)` for workers
- [ ] For retry logic around external calls:
  - Replace custom retry loops with `core/queue.withRetry(fn, options)`

**6.3 DLQ and Observability**

- [ ] Ensure jobs have:
  - Sensible `maxAttempts` and backoff policies
  - DLQ handling where appropriate (reusing existing platform patterns)
- [ ] Confirm logs include:
  - Queue name, job id/name, duration, error message where relevant

---

### 7. Final Drift & Landmine Sweep (per repo)

Before declaring the migration “done” for `<repo-name>`, run:

- **Stripe**
  - [ ] MCP `search_text` for `stripe.` and `require("stripe")` — only allowed in shared core (`core/stripe`) or legacy code explicitly marked for removal
- **Email**
  - [ ] MCP `search_text` for `MailerSend`, `Maileroo`, `Resend`, `sendEmail(`
    - Ensure all sending goes through repo‑level helpers → `core/email`
- **Queue / Retry**
  - [ ] MCP `search_text` or Grep for:
    - `require("bullmq")`, `new Queue(`, `new Worker(`
    - Custom retry loops on network I/O

Any remaining direct usage should either:

- Be migrated to the core modules, or
- Be explicitly documented as an intentional exception (with justification).

---

### 8. Sign‑off Criteria

A repo’s migration to core modules is **complete** when:

- [ ] All feature flags `CORE_STRIPE_ENABLED`, `CORE_EMAIL_ENABLED`, `CORE_QUEUE_ENABLED` are **on** in production.
- [ ] Tests and smoke scripts pass for:
  - Stripe checkout + webhooks
  - Email sending for major flows
  - Background jobs and retry behavior
- [ ] Drift and landmine sweeps report:
  - No unexpected direct Stripe/email/queue usages
  - No high‑risk ad‑hoc retry loops for external calls

Record the date and the agent/team who approved sign‑off here.

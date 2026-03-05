## CookiesPass v1 – Core-backed Stripe & Email Demo (3-day target)

**Goal:** Make CookiesPass the first real consumer of `core/stripe` and `core/email` with a rock-solid, demo-ready happy path for Berner in 3 days.

This spec is **Day 1 output only** – no UI or core implementation here, just the contract that implementation agents must hit.

---

## 1. Current State (MCP scan summary)

**Repos scanned via MCP (`user-jcodemunch`):**

- `local/CookiesPass`
  - **Pricing:** `client/src/lib/pricing.ts`
    - `PricingItem` and `PricingCategory` types.
    - `EVERYDAY_PRICING` map with category → items → `{ name, price, note? }`.
    - Used by `client/src/pages/Deals.tsx` and other client surfaces.
  - **Loyalty / flows:** `server/index.ts`, `server/services/walletpass.ts`
    - SMS/push copy references “show this pass at checkout” and “mention it at checkout”.
    - `buildCategoryDealsText` in `walletpass.ts` derives text from real Cookies Tempe pricing.
  - **Auth:** app-specific auth and session handling (no direct Stripe integration).
  - **Email:** no `sendEmail` symbol, and no obvious email provider integration in the current index.
  - **Stripe:** no `stripe.` usage and no hosted checkout or webhook routes yet.

- `local/cookies-tempe`
  - Used as a **source of truth for in-store pricing and deals**.
  - `script/build.ts` includes `"stripe"` as a dependency but there is no full Stripe flow exported for reuse.

- Stripe exemplar repos:
  - `local/v0-skyn-patch`
    - `lib/stripe.ts::createCheckoutSessionWithCustomer` is the **canonical pattern** for creating a Stripe Checkout session with:
      - Line-item construction for one-time or subscription modes.
      - Customer lookup/creation.
      - Metadata for source and analytics.
      - Discount code and coupon handling.
  - `local/BlackWallStreetopoly`
    - `server/lib/resilient-stripe.ts` and `app/api/stripe/create-checkout-session/route.ts` show:
      - zod-validated request payloads.
      - Separation between API routes and Stripe helpers.
      - Robust error handling and admin tooling.

**Gap summary:**

- CookiesPass has **rich pricing and loyalty state**, but **no Stripe checkout or webhooks**, and **no email abstraction**.
- CookiesPass and cookies-tempe both need to **consume `core/stripe` and `core/email`** rather than talk to Stripe/email providers directly.

---

## 2. Core Contracts to Implement (in `core/stripe` and `core/email`)

Implementation agents must fill in the existing skeletons in:

- `core/stripe.js`
- `core/email.js`

### 2.1 `core/stripe.createCheckoutSession(options)`

**Purpose:** Create a Stripe Checkout session for a CookiesPass purchase, using exemplars from `v0-skyn-patch` and `BlackWallStreetopoly`.

**Inputs (minimum contract):**

- `options.customer`:
  - `email` (string, required)
  - `name` (string, optional)
- `options.items`: array of:
  - `name` (string)
  - `price_cents` (integer, USD cents)
  - `quantity` (integer)
  - `description` (string, optional)
  - `image` (string URL, optional)
- `options.mode`: `"payment"` (default) or `"subscription"`.
- `options.successUrl`: absolute URL string.
- `options.cancelUrl`: absolute URL string.
- `options.metadata` (optional object):
  - `source`: `"cookiespass"` (default).
  - `cookiespass_plan`: e.g. `"tempe-annual"`, `"tempe-monthly"`.
  - Any additional tracking keys (campaign, experiment, etc.).

**Behavior:**

- Look up or create a Stripe customer using email + optional name (following `getOrCreateStripeCustomer` pattern from `v0-skyn-patch`).
- Build `Stripe.Checkout.SessionCreateParams` similar to `createCheckoutSessionWithCustomer`:
  - `mode` from `options.mode`.
  - `line_items` from `options.items` (USD, `unit_amount` in cents).
  - `success_url`, `cancel_url`.
  - `billing_address_collection: "required"`.
  - For one-time payments:
    - `payment_method_types: ["card", "cashapp"]` (match exemplar unless config overrides).
    - `payment_intent_data.metadata` mirrors key metadata fields (customerName, customerId, source).
  - For subscriptions:
    - `payment_method_types: ["card"]`.
    - `recurring` on price data for subscription items.
- Apply discount if present:
  - Optional `options.discountCode` or `options.couponId` with the same semantics as in `v0-skyn-patch` (look up promo code, fall back to coupon, or attach explicit couponId).
- Enforce idempotency via a generated idempotency key based on logical order (email + plan + maybe timestamp window).

**Outputs:**

- Return a **minimal DTO**:
  - `sessionId`
  - `url`
  - `customerId`

Internally, `core/stripe` may retain the full Stripe session for auditing, but callers (CookiesPass API routes) should only depend on this DTO.

### 2.2 `core/stripe.handleStripeWebhook(rawBody, headers)`

**Purpose:** Single entrypoint for all Stripe webhooks for all sites, including CookiesPass.

**Inputs:**

- `rawBody`: `Buffer` or string from HTTP request body.
- `headers`: HTTP headers object including `stripe-signature`.

**Behavior:**

- Verify the webhook signature using Stripe SDK and an env-specific secret:
  - Use the same pattern as `verifyWebhookSignature` in `v0-skyn-patch/lib/stripe.ts`.
  - Reject invalid signatures with a non-leaky error.
- Detect replayed events:
  - Use a persistent store of processed event IDs (usually Postgres via `core/queue` / audit tables).
  - If the event has already been handled, return a no-op result.
- Normalize the event into a small internal shape:
  - `type` (e.g. `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`).
  - `customerId`, `subscriptionId`, `paymentIntentId`, `amount`, `currency`, etc.
- Dispatch to **domain handlers** (CookiesPass is just one domain consumer):
  - For `checkout.session.completed` tied to CookiesPass (by `metadata.source === "cookiespass"` or specific product IDs), emit a domain event such as `cookiespass_pass_purchased`.
  - For subscriptions, call `syncSubscriptionState`.
- Record the event for auditing via `recordStripeEvent`.

**Outputs:**

- On success: a normalized result such as `{ ok: true, handledDomains: [...], eventId }`.
- On verification failure: `{ ok: false, error: "invalid_signature", eventId? }`.
- On other errors: `{ ok: false, error: "internal_error", eventId }`, with retryable vs non-retryable classification handled by upstream queue logic.

### 2.3 `core/stripe.syncSubscriptionState(event)`

For CookiesPass v1 this is **minimal**:

- If `event.metadata.source === "cookiespass"` and a subscription is involved:
  - Upsert a subscription record in the platform DB with:
    - `customer_id`, `subscription_id`, `status`, `current_period_end`, `plan_id`, `site = "cookiespass-tempe"`.
  - Emit or enqueue a secondary event for CookiesPass to update any local state if needed.

### 2.4 `core/email.sendEmail(message)`

**Purpose:** Unified email sending, used by CookiesPass and other sites.

**Inputs (minimum contract for this campaign):**

- `to`: string email address.
- `from`: optional; if omitted, derive from site config (CookiesPass default sender).
- `subject`: string.
- `text`: string body (plain text).
- `html`: optional HTML body.
- `tags`: optional list of strings including `"cookiespass"` and `"order_receipt"` / `"welcome"`.

**Behavior:**

- Delegate to a provider driver (Resend or current default) based on env/config.
- Ensure each send:
  - Includes site + flow metadata in provider tags / headers for analytics.
  - Is logged in a structured log or audit table.

**Outputs:**

- `{ id, provider, status }` minimal DTO.

---

## 3. CookiesPass v1 Demo Flows

### 3.1 Happy-path purchase (“demo for Berner”)

**User story:**

- User lands on CookiesPass landing/deals page.
- Clicks **“Buy CookiesPass”** (or equivalent CTA).
- Flow:
  1. Frontend calls **`POST /api/checkout`** with:
     - Selected plan SKU (e.g. `"cookiespass-tempe-annual"`).
     - User email + name.
  2. `/api/checkout`:
     - Resolves SKU to 1–2 line items using `EVERYDAY_PRICING` / a simple price table.
     - Calls `core/stripe.createCheckoutSession(...)` with `metadata.source = "cookiespass"` and `metadata.cookiespass_plan` set.
     - Returns `{ url }`.
  3. Frontend redirects the browser to Stripe Checkout.
  4. Stripe hosts the payment flow.
  5. On success, Stripe hits **`/api/stripe/webhook`**:
     - `core/stripe.handleStripeWebhook` verifies and normalizes the event.
     - When `checkout.session.completed` for CookiesPass:
       - Emit `cookiespass_pass_purchased` domain event with:
         - `email`, `plan`, `amount`, `stripe_customer_id`, `stripe_subscription_id?`.
       - Trigger a small follow-up job (can be Trigger.dev or queue-backed):
         - Call `core/email.sendEmail` twice:
           - **Receipt**.
           - **“Welcome to CookiesPass”** with clear “show this at checkout” instruction.
  6. Frontend `success_url` page:
     - Reads a `status=success` flag and optionally a short token.
     - Shows:
       - “You’re in.” message.
       - Plan name and amount.
       - Reminder: “Show this at checkout to redeem your deals.”

**Out-of-scope for this 3-day target:**

- Complex upgrades/downgrades.
- Partial refunds, proration, or coupon stacking beyond the basic coupon/couponId pattern inherited from `v0-skyn-patch`.

### 3.2 Optional subscription add-on

If CookiesPass needs an **ongoing membership** instead of one-time:

- Use `options.mode = "subscription"` in `createCheckoutSession`.
- Use Stripe prices with `recurring` metadata, following `createCheckoutSessionWithCustomer`.
- Ensure webhook handlers:
  - Map `customer.subscription.created/updated/canceled` events into `syncSubscriptionState`.

---

## 4. API Routes & Thin Adapters (to be implemented in CookiesPass repo)

Implementation agents working in `local/CookiesPass` should create **thin adapters** that depend only on `core/stripe` and `core/email`:

- `POST /api/checkout`
  - Validates payload (zod or equivalent).
  - Maps plan SKU → line items (from `pricing.ts` or a small config table).
  - Calls `core/stripe.createCheckoutSession`.
  - Returns `{ url }`.

- `POST /api/stripe/webhook`
  - Reads raw body + headers.
  - Calls `core/stripe.handleStripeWebhook`.
  - Returns `200` for handled or ignored events, appropriate error code for invalid signatures.

No direct `stripe.` SDK calls, no provider-specific email calls, and no new JSON state files are allowed in these routes.

---

## 5. UX & Logging Requirements for the Demo

- **UX:**
  - Single, clear “Buy now” or “Get CookiesPass” entry point.
  - Clean success page with:
    - Plan name.
    - Price paid.
    - “Show this pass at checkout” reminder.
  - Simple error page for failed or canceled checkouts with a “try again” CTA.

- **Logging / observability:**
  - `core/stripe` functions emit structured logs with:
    - `site: "cookiespass"`.
    - `flow: "checkout"` or `"subscription"`.
    - `customer_email`, `plan`, `amount`, and outcome.
  - `core/email.sendEmail` includes `site` and `flow` tags for receipts and welcomes.
  - Enough event logging exists to show “events flowing” in a terminal or log viewer during the demo.

---

## 6. Agent Tasks for Days 2–3 (forward pointers)

These are **not** executed in this Day 1 spec, but define how agents should use this document:

- **Day 2 – Implement flows**
  - Implement `core/stripe` and `core/email` per this spec using patterns from:
    - `local/v0-skyn-patch/lib/stripe.ts`.
    - `local/BlackWallStreetopoly/server/lib/resilient-stripe.ts`.
  - Add `/api/checkout` and `/api/stripe/webhook` in `local/CookiesPass` as thin wrappers.
  - Wire minimal Trigger.dev or queue jobs for follow-up email sends if needed.

- **Day 3 – Polish & harden**
  - Run MCP sweeps on `local/CookiesPass` and `local/cookies-tempe` to verify:
    - No raw `stripe.` usage in those repos.
    - All email sending for CookiesPass goes through `core/email.sendEmail`.
    - No new JSON state anti-patterns.
  - Tighten UX and copy on success/failure pages.
  - Confirm logs show end-to-end flow for at least one happy-path purchase.


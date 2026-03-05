## Core Stripe Pattern

This document defines the canonical Stripe billing and webhook patterns for OpenClaw. Research agents should keep it up to date using MCP searches over the configured exemplar repos in `config/domain-exemplars.json`.

### 1. Scope

- Checkout session creation (one-time and subscription).
- Webhook handling for payments, subscriptions, and invoices.
- Subscription state synchronization.
- Event logging and replay handling.

### 2. Required Inputs and Outputs

- **createCheckoutSession(options)**
  - Inputs: customer identity, line items or price IDs, success/cancel URLs, optional metadata.
  - Output: Stripe Checkout session object (or a minimal DTO containing session ID and URL).

- **handleStripeWebhook(rawBody, headers)**
  - Inputs: raw request body, HTTP headers (including Stripe-Signature).
  - Output: normalized event object and side effects (logged, queued, or applied), or an error result.

- **syncSubscriptionState(event)**
  - Inputs: normalized Stripe event representing subscription lifecycle changes.
  - Output: updated subscription record in the local database and any follow-up jobs enqueued.

### 3. Invariants

- All Stripe operations are **idempotent**:
  - Webhook handlers use idempotency keys or event IDs to avoid double-processing.
  - Checkout/session handlers avoid creating duplicate charges for the same logical intent.
- Raw Stripe SDK calls are performed **only** inside `core/stripe`, never in SaaS repos.
- All database writes include the relevant audit metadata (who/when/what event).

### 4. Failure Behavior

- Verification failures (invalid signature, malformed payload) return an error and are logged with structured context.
- Transient failures (network, rate limits) are retried with exponential backoff via the queue/retry layer.
- Irrecoverable failures are written to an audit/dead-letter stream for manual inspection.

### 5. Webhook Signature and Replay Handling

- `handleStripeWebhook` must:
  - Verify signatures using Stripe’s official helpers against the configured webhook secret.
  - Reject requests that fail verification with a clear, non-leaky error.
  - Detect replayed events using a persisted record of processed event IDs and ignore duplicates.

### 6. Logging and Observability

- All public core functions must emit structured JSON logs that include:
  - Correlation IDs (request ID, customer ID, subscription ID, event ID).
  - Outcome (`success`, `retry`, `dead_letter`).
  - Latency and retry metadata when applicable.

### 7. Retry Strategy

- Core functions that perform network I/O (Stripe API calls, DB writes) should:
  - Use the shared retry helpers from `core/queue` with exponential backoff and jitter.
  - Mark tasks as failed and enqueue them to a DLQ after exhausting retries.

### 8. Reference Implementations (via MCP)

Research agents should maintain links here to the current best-in-class implementations discovered with MCP:

- Stripe webhook handling:
  - `local/BlackWallStreetopoly` – primary webhook handler function.
  - `local/v0-skyn-patch` – checkout and order recovery flows.
- Internal payment router:
  - `local/claw-architect/scripts/payment-router.js` – multi-rail payments and audit logging.

Use `search_symbols` and `get_symbol` across the Stripe exemplar repos listed in `config/domain-exemplars.json` to keep these references current.


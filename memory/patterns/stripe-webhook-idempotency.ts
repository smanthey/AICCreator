import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "stripe",
  type: "pattern",
  name: "webhook_idempotency",
  summary: "Ensure Stripe webhook events are processed exactly once across all services.",
  invariants: [
    "Every processed Stripe event.id is recorded in a durable store (e.g. stripe_events table).",
    "Webhook handler is idempotent: re-processing the same event.id does not create new side effects.",
    "Webhook handler always validates event type and object before acting.",
  ],
  failure_modes: [
    "Duplicate invoice creation from replayed invoice.payment_succeeded events.",
    "Double subscription update or cancellation from retried webhook deliveries.",
    "Inconsistent state when local side effects succeed but idempotency record is not written.",
  ],
  canonical_implementation: {
    repo: "local/PayClaw",
    file: "scripts/payment-router.js",
    symbol: "handleStripeWebhook",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "scripts/payment-router.js",
    symbol: "handleStripeWebhook",
  },
  notes: [
    "Stripe can and will retry webhook deliveries; handlers must be safe to run multiple times.",
    "Use a unique constraint on event.id in the persistence layer to enforce deduplication.",
    "Downstream queues / workers must also be idempotent with respect to the originating event.id.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["stripe", "webhook", "idempotency", "billing", "pattern"],
});


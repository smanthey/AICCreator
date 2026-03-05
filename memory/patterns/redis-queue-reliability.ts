import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "queue",
  type: "pattern",
  name: "redis_queue_reliability",
  summary:
    "All Redis-backed queues (BullMQ, task dispatch) must have explicit retry profiles, DLQ routing, and health checks wired into Mission Control.",
  invariants: [
    "Every queue has a configured retry profile (max attempts, backoff, timeout) defined in a central config, not inline.",
    "Dead letters are routed to a first-class DLQ with deterministic requeue/cancel policies.",
    "Queue health is observable via `npm run tasks:health` and surfaced in the dashboard.",
  ],
  failure_modes: [
    "Invisible stuck jobs when queues silently stop processing without alerts.",
    "Hot-loop retries that hammer external APIs or Stripe when backoff is misconfigured.",
    "Silent data loss when failed jobs are dropped instead of being quarantined in DLQ.",
  ],
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "control/dlq.js",
    symbol: "handleDeadLetter",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "control/dispatcher.js",
    symbol: "enqueueTask",
  },
  notes: [
    "See docs/OPENCLAW_TOP10_ADOPTABLE_PATTERNS.md → DLQ + replay/reconcile loop.",
    "Retry profiles should live in config (e.g. config/task-routing.js) and be audited.",
    "Dead letters must be reconciled regularly via scripts/dead-letter-reconcile.js and surfaced in reports.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["redis", "queue", "dlq", "retry", "pattern"],
});


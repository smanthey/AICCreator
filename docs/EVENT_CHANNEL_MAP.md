# Event channel map (mediated swarm)

Domain events and task execution channels. Redis Streams are used for event fan-out; BullMQ remains the execution path. All actions still go through the task pipeline and policy.

## Channel (stream name) reference

| Channel (stream name) | Purpose | Producers | Consumers |
|----------------------|---------|-----------|-----------|
| `events.raw` | Raw ingest (webhooks, API) | Webhook server, future ingest services | (Optional) normalizer / idempotency |
| `events.domain` | Normalized domain events | Loyalty engine (after DB emit), future credit/CRM | Analytics, CRM listener, task spawner |
| `tasks.engine.*` | (Conceptual) Deterministic work | Dispatcher (BullMQ queues are the actual transport) | Workers (see [WORKER_TAG_MATRIX.md](WORKER_TAG_MATRIX.md)) |
| `tasks.ai.*` | LLM work | Same | Workers (claw_tasks_ai) |
| `audit.log` | (Optional) Audit trail | Workers / policy engine | Log sink, dashboards |

## Implementation status

- **events.domain**: Implemented. `control/event-bus.js` publishes to Redis stream `events.domain`. Loyalty engine calls it after `emitDomainEvent(db, row)` when `LOYALTY_PUBLISH_EVENTS_TO_REDIS=true`. **Canonical entry shape**: `event_id` (UUID), `version` (integer), `idempotency_key`, `event_type`, `domain`, `payload` (JSON), `occurred_at`, `domain_event_key` (backward compat), optional `source_system`, `source_event_id`.
- **events.raw**: Not implemented; reserved for future raw webhook/API publish.
- **tasks.engine.* / tasks.ai.***: Represented by BullMQ queues (claw_tasks_infra, claw_tasks_io_heavy, claw_tasks_ai, etc.); see task-routing and worker tag matrix.
- **audit.log**: Not implemented; reserved for optional audit stream.

## Optional consumer (events.domain)

- **scripts/events-domain-consumer.js**: Reads from Redis stream `events.domain`, logs each event, and optionally writes to `event_bus_audit` when `EVENTS_AUDIT_TO_PG=true`. Run once to drain available events, or `--watch` to block and process new events. Table: `migrations/063_event_bus_audit.sql`.

## Consumer rules

- Event consumers must not perform actions directly. They create tasks (via inserter or follow-up path) so execution is policy-gated.
- No cyclic event loops: e.g. one task per event, or a cap per event type.

## References

- `control/event-bus.js` — publishDomainEvent
- `control/loyalty/engine.js` — emitDomainEvent + optional Redis publish
- [WORKER_TAG_MATRIX.md](WORKER_TAG_MATRIX.md) — queue and tag mapping

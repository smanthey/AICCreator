# Event plane runbook

Failure modes and mitigations for the production event plane (Redis Streams, consumer groups, event_receipts, spawner).

## A) Redis restarts / dropped connections

**Symptoms:** Consumers stop reading; BullMQ workers throw connection errors; pending messages accumulate.

**Mitigations:**
- Redis AOF + `appendfsync everysec` (see [context/REDIS_PRODUCTION.md](../context/REDIS_PRODUCTION.md)).
- ioredis reconnects automatically; consumer loop continues after reconnect.
- If no events consumed in N minutes, alert (e.g. monitor `events_domain_pending_cg_auditor` and `events_domain_pending_cg_spawner` on `/health`).
- Run `infra/redis-config-check.sh` before start; optional timeout via `REDIS_TIMEOUT`.

## B) Duplicate delivery / replay storms

**Symptoms:** Double loyalty points, duplicate CRM entries, wallet update spam.

**Mitigations:**
- **event_receipts**: Each consumer group records `(event_id, consumer_group)` and `payload_hash`. Process once per group; skip if already `processed` with same hash.
- **Task idempotency**: Tasks use `idempotency_key`; task_runs prevent double execution.
- **Spawner rate limit**: `shouldSpawnTask(eventType, entityId)` uses Redis key with TTL (`EVENT_SPAWN_DEBOUNCE_MINUTES`); one spawn per key per window.
- Handlers should be idempotent or rely on receipt to skip.

## C) Poison messages (bad schema, unknown version)

**Symptoms:** Consumer stuck reprocessing same pending item; handler throws repeatedly.

**Mitigations:**
- **maxDeliveries**: After N deliveries (default 5), message is written to `dlq:events.domain` and ACKed so it stops looping.
- **Version check**: Stream entries have `version`; consumer skips and ACKs when `version > SUPPORTED_VERSION`.
- Validate payload shape before handler; return `{ status: 'dead', reason }` for invalid schema so it goes to DLQ.

## D) Consumer dies mid-processing

**Symptoms:** Message stays pending forever; no one claims it.

**Mitigations:**
- **Pending recovery**: `createStreamConsumer` runs a claim loop; messages idle > `claimIdleMs` are claimed via `XCLAIM` by this (or another) consumer.
- **event_receipts**: Rows with `status = 'processing'` and `last_seen_at` older than claim threshold are considered stale; another delivery can proceed (receipt takeover).

## E) Out-of-order events

**Symptoms:** Refund before completion; "updated" before "created"; analytics wrong.

**Mitigations:**
- Use `occurred_at` and optional sequence when present; store per-subject `last_sequence` / `last_occurred_at` if ordering is required.
- Ledger-style domains (e.g. loyalty) tolerate order; use append-only transactions.
- Document compensating events (e.g. refund reverses points) where needed.

## F) Backpressure and queue overload

**Symptoms:** AI queue grows unbounded; NAS I/O tasks stall.

**Mitigations:**
- Per-queue concurrency via env (`WORKER_CONCURRENCY_AI`, etc.) and dispatch batch limit cap (1–100).
- Spawner rate limit (`EVENT_SPAWN_DEBOUNCE_MINUTES`, `shouldSpawnTask`).
- Optional circuit breaker: if BullMQ queue length (e.g. `claw_tasks_ai`) > `SPAWNER_MAX_AI_QUEUE_LENGTH`, spawner returns `{ status: 'retry' }` so event is redelivered later.

## G) Postgres slowdowns / lock contention

**Symptoms:** Dispatcher falls behind; inserter blocks; consumers time out.

**Mitigations:**
- Indexes: `event_receipts(event_id, consumer_group)`, `event_receipts(idempotency_key, consumer_group)`, `event_receipts(stream, consumer_group, status)`.
- Keep inserts small; batch where possible.
- Dispatcher uses `FOR UPDATE SKIP LOCKED` for task claim.

## H) Partial deploys / version skew

**Symptoms:** New consumers read new event versions and crash; handlers expect fields that aren’t there.

**Mitigations:**
- **Event versioning**: Publisher sends `version`; bump when payload shape changes. Consumers skip unsupported version and ACK.
- **Feature flag**: Publish to stream behind `LOYALTY_PUBLISH_EVENTS_TO_REDIS` (and `EVENTS_PUBLISH_DOMAIN_TO_REDIS`).
- Backward compatibility: stream entry still includes `domain_event_key`; consumers treat missing `event_id` as legacy (no receipt dedupe).

## Health and metrics

- **GET /health**: Includes `events_domain_pending_cg_auditor` and `events_domain_pending_cg_spawner`. Value like `ok: 0` or `warn: 1200 pending` when over `EVENTS_LAG_WARN` (default 1000).
- Optional: extend with events/sec, tasks created/sec, queue length (e.g. `/metrics` or a `metrics` object in health).

## References

- [EVENT_CHANNEL_MAP.md](EVENT_CHANNEL_MAP.md)
- [control/stream-consumer.js](../control/stream-consumer.js) — consumer abstraction
- [control/event-task-mapper.js](../control/event-task-mapper.js) — event-to-task mapping and rate limit
- [migrations/064_event_receipts.sql](../migrations/064_event_receipts.sql)

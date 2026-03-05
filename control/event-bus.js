"use strict";

/**
 * Event bus: publish domain events to Redis Streams for fan-out.
 * Consumers use consumer groups and event_receipts for idempotency.
 * DB remains source of truth.
 *
 * Stream entry fields: event_id (UUID), version, idempotency_key, event_type, domain,
 * payload (JSON), occurred_at, domain_event_key (backward compat), source_system, source_event_id.
 */

const { v4: uuid } = require("uuid");
const DEFAULT_STREAM = process.env.EVENTS_STREAM_DOMAIN || "events.domain";

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

/**
 * Publish a domain event to a Redis stream.
 * @param {string} streamKey - Stream name (e.g. "events.domain")
 * @param {object} event - { event_type, payload, occurred_at, domain?, domain_event_key?, idempotency_key?, version?, event_id?, ... }
 * @returns {Promise<string|null>} Redis stream entry id, or null if disabled/failed
 */
async function publishDomainEvent(streamKey, event) {
  if (!envBool("EVENTS_PUBLISH_DOMAIN_TO_REDIS", true)) return null;

  let redis;
  try {
    redis = require("../infra/redis");
  } catch (e) {
    return null;
  }

  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? JSON.stringify(event.payload)
      : String(event.payload ?? "{}");

  const eventId = event.event_id || uuid();
  const idempotencyKey = event.idempotency_key != null
    ? String(event.idempotency_key)
    : String(event.domain_event_key ?? "");

  const entry = {
    event_id: eventId,
    version: String(event.version != null ? event.version : 1),
    idempotency_key: idempotencyKey,
    event_type: String(event.event_type ?? ""),
    domain: String(event.domain ?? ""),
    payload,
    occurred_at: String(event.occurred_at ?? new Date().toISOString()),
    domain_event_key: String(event.domain_event_key ?? idempotencyKey),
  };

  if (event.source_system != null) entry.source_system = String(event.source_system);
  if (event.source_event_id != null) entry.source_event_id = String(event.source_event_id);

  const stream = streamKey || DEFAULT_STREAM;
  const args = [];
  for (const [k, v] of Object.entries(entry)) {
    args.push(k, v);
  }

  try {
    const id = await redis.xadd(stream, "*", ...args);
    return id;
  } catch (err) {
    console.warn("[event-bus] publish failed:", err.message);
    return null;
  }
}

module.exports = {
  publishDomainEvent,
  DEFAULT_STREAM,
};

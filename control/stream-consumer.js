"use strict";

/**
 * Production Redis Streams consumer: consumer groups, at-least-once delivery,
 * idempotency via event_receipts, pending recovery (XCLAIM), DLQ stream, safe shutdown.
 *
 * Handler returns: { status: 'ok' } | { status: 'skip', reason } | { status: 'retry', reason } | { status: 'dead', reason, detail? }
 * - retry: do not ACK; message stays pending.
 * - dead: write to DLQ stream, then ACK.
 * - skip: ACK (e.g. unsupported version).
 */

const crypto = require("crypto");
const redis = require("../infra/redis");
const pg = require("../infra/postgres");

const SUPPORTED_VERSION = 1;
const CLAIM_IDLE_MS_DEFAULT = 60_000;
const MAX_DELIVERIES_DEFAULT = 5;
const DLQ_STREAM_PREFIX = "dlq:";

function parseStreamEntry(streamId, fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  let payload = obj.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { raw: payload };
    }
  }
  const idempotencyKey = obj.idempotency_key != null ? obj.idempotency_key : (obj.domain_event_key || "");
  return {
    stream_id: streamId,
    event_id: obj.event_id || null,
    event_type: obj.event_type || "",
    domain: obj.domain || "",
    version: parseInt(obj.version, 10) || 1,
    occurred_at: obj.occurred_at || null,
    idempotency_key: idempotencyKey,
    payload,
    domain_event_key: obj.domain_event_key || "",
    source_system: obj.source_system || null,
    source_event_id: obj.source_event_id || null,
  };
}

function payloadHash(payload) {
  const str = typeof payload === "object" && payload !== null
    ? JSON.stringify(payload)
    : String(payload ?? "{}");
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function ensureGroup(redisClient, stream, group) {
  try {
    await redisClient.xgroup("CREATE", stream, group, "0", "MKSTREAM");
  } catch (e) {
    if (!/BUSYGROUP|already exists/i.test(e.message)) throw e;
  }
}

async function upsertReceipt(opts) {
  const { eventId, stream, group, consumerName, eventType, idempotencyKey, payloadHash: hash, status, deliveries } = opts;
  if (!eventId || !pg) return null;
  await pg.query(
    `INSERT INTO event_receipts
       (event_id, consumer_group, stream, consumer_name, event_type, idempotency_key, payload_hash, status, first_seen_at, last_seen_at, deliveries, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), $9, NULL)
     ON CONFLICT (event_id, consumer_group)
     DO UPDATE SET
       last_seen_at = NOW(),
       deliveries = event_receipts.deliveries + 1,
       status = EXCLUDED.status,
       payload_hash = EXCLUDED.payload_hash,
       last_error = NULL`,
    [eventId, group, stream, consumerName || "", eventType, idempotencyKey, hash, status, deliveries ?? 1]
  );
}

async function getReceipt(eventId, group) {
  if (eventId == null) return null;
  const { rows } = await pg.query(
    `SELECT status, payload_hash, deliveries FROM event_receipts WHERE event_id = $1 AND consumer_group = $2`,
    [eventId, group]
  );
  return rows[0] || null;
}

async function setReceiptStatus(eventId, group, status, lastError = null) {
  await pg.query(
    `UPDATE event_receipts SET status = $3, last_seen_at = NOW(), last_error = $4 WHERE event_id = $1 AND consumer_group = $2`,
    [eventId, group, status, lastError]
  );
}

async function writeDlq(redisClient, stream, group, consumerName, streamId, evt, reason, detail) {
  const dlqStream = DLQ_STREAM_PREFIX + stream;
  const entry = {
    original_stream: stream,
    original_stream_id: streamId,
    consumer_group: group,
    consumer: consumerName,
    dead_reason: reason,
    dead_at: new Date().toISOString(),
    event_id: evt.event_id || "",
    event_type: evt.event_type || "",
    idempotency_key: evt.idempotency_key || "",
    payload: JSON.stringify(evt.payload || {}),
  };
  if (detail != null) entry.detail = typeof detail === "object" ? JSON.stringify(detail) : String(detail);
  const args = [];
  for (const [k, v] of Object.entries(entry)) {
    args.push(k, v);
  }
  await redisClient.xadd(dlqStream, "*", ...args);
}

function createStreamConsumer(opts) {
  const {
    stream,
    group,
    consumer: consumerName,
    blockMs = 5000,
    readCount = 10,
    concurrency = 3,
    claimIdleMs = CLAIM_IDLE_MS_DEFAULT,
    maxDeliveries = MAX_DELIVERIES_DEFAULT,
    dedupe = { mode: "db" },
    handler,
    onMetric,
    onLog,
  } = opts;

  if (!stream || !group || !consumerName || typeof handler !== "function") {
    throw new Error("createStreamConsumer requires stream, group, consumer, handler");
  }

  let running = true;
  let inFlight = 0;
  const concurrencyLimit = Math.max(1, concurrency);

  function log(level, msg, meta) {
    if (typeof onLog === "function") onLog(level, msg, meta);
    else if (level === "error") console.error(`[stream-consumer:${group}]`, msg, meta || "");
    else if (level === "warn") console.warn(`[stream-consumer:${group}]`, msg, meta || "");
  }

  function metric(name, value, tags) {
    if (typeof onMetric === "function") onMetric(name, value, tags || {});
  }

  async function processOne(streamId, evt, deliveries) {
    const eventId = evt.event_id;
    const hash = payloadHash(evt.payload);

    if (dedupe.mode === "db" && eventId) {
      const receipt = await getReceipt(eventId, group);
      if (receipt) {
        if (receipt.status === "processed" && receipt.payload_hash === hash) {
          metric("events_skipped_duplicate", 1, { group });
          return "ack";
        }
        if (receipt.status === "processing") {
          const idleSec = Math.ceil(claimIdleMs / 1000);
          const { rows: staleRows } = await pg.query(
            `SELECT (NOW() - last_seen_at) > ($1::int * INTERVAL '1 second') AS stale FROM event_receipts WHERE event_id = $2 AND consumer_group = $3`,
            [idleSec, eventId, group]
          );
          if (!staleRows[0]?.stale) {
            return "ack";
          }
        }
      }
      await upsertReceipt({
        eventId,
        stream,
        group,
        consumerName,
        eventType: evt.event_type,
        idempotencyKey: evt.idempotency_key,
        payloadHash: hash,
        status: "processing",
        deliveries: deliveries || 1,
      });
    }

    if (evt.version > SUPPORTED_VERSION) {
      if (dedupe.mode === "db" && eventId) {
        await setReceiptStatus(eventId, group, "skipped", "unsupported_version");
      }
      metric("events_skipped_version", 1, { group });
      return "ack";
    }

    let result;
    try {
      result = await handler(evt);
    } catch (err) {
      log("error", `handler threw: ${err.message}`, { stream_id: streamId, event_id: eventId });
      if (dedupe.mode === "db" && eventId) {
        await setReceiptStatus(eventId, group, "processing", err.message);
      }
      return "retry";
    }

    const status = result?.status || "retry";
    if (status === "ok" || status === "skip") {
      if (dedupe.mode === "db" && eventId) {
        await setReceiptStatus(eventId, group, "processed", null);
      }
      metric("events_processed", 1, { group, status });
      return "ack";
    }
    if (status === "dead") {
      await writeDlq(redis, stream, group, consumerName, streamId, evt, result.reason || "dead", result.detail);
      if (dedupe.mode === "db" && eventId) {
        await setReceiptStatus(eventId, group, "dead", result.reason || "dead");
      }
      metric("events_dead", 1, { group });
      return "ack";
    }
    if (deliveries >= maxDeliveries) {
      await writeDlq(redis, stream, group, consumerName, streamId, evt, `max_deliveries_${maxDeliveries}`, null);
      if (dedupe.mode === "db" && eventId) {
        await setReceiptStatus(eventId, group, "dead", `max_deliveries_${maxDeliveries}`);
      }
      metric("events_dead_max_deliveries", 1, { group });
      return "ack";
    }
    return "retry";
  }

  async function runLoop() {
    await ensureGroup(redis, stream, group);
    while (running) {
      try {
        const replies = await redis.xreadgroup(
          "GROUP", group, consumerName,
          "BLOCK", blockMs,
          "COUNT", readCount,
          "STREAMS", stream, ">"
        );
        if (!replies || replies.length === 0) continue;
        const [, messages] = replies[0];
        if (!messages || messages.length === 0) continue;
        for (const [streamId, fields] of messages) {
          while (inFlight >= concurrencyLimit && running) {
            await new Promise((r) => setTimeout(r, 50));
          }
          if (!running) break;
          inFlight += 1;
          const evt = parseStreamEntry(streamId, fields);
          const receipt = evt.event_id ? await getReceipt(evt.event_id, group) : null;
          const deliveries = receipt ? (receipt.deliveries || 0) + 1 : 1;
          processOne(streamId, evt, deliveries)
            .then((action) => {
              if (action === "ack") {
                return redis.xack(stream, group, streamId);
              }
            })
            .catch((err) => {
              log("error", `processOne failed: ${err.message}`, { stream_id: streamId });
            })
            .finally(() => {
              inFlight -= 1;
            });
        }
      } catch (err) {
        if (!running) break;
        log("error", `read loop: ${err.message}`, {});
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    for (let i = 0; i < 100 && inFlight > 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function runPendingRecovery() {
    while (running) {
      try {
        await new Promise((r) => setTimeout(r, Math.max(claimIdleMs, 15000)));
        if (!running) break;
        const pending = await redis.xpending(stream, group, "-", "+", 50);
        if (!pending || !pending.length) continue;
        for (const p of pending) {
          const [id, consumer, idleMs] = p;
          if (Number(idleMs) >= claimIdleMs) {
            try {
              await redis.xclaim(stream, group, consumerName, claimIdleMs, id);
            } catch (e) {
              if (!running) break;
              log("warn", `claim ${id} failed: ${e.message}`, {});
            }
          }
        }
      } catch (err) {
        if (!running) break;
        log("warn", `pending recovery: ${err.message}`, {});
      }
    }
  }

  function stop() {
    running = false;
  }

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  return {
    run: async () => {
      await Promise.all([runLoop(), runPendingRecovery()]);
    },
    stop,
  };
}

module.exports = {
  createStreamConsumer,
  parseStreamEntry,
  payloadHash,
  SUPPORTED_VERSION,
  DLQ_STREAM_PREFIX,
};

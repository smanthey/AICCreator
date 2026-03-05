#!/usr/bin/env node
"use strict";

/**
 * events.domain consumer using production stream-consumer abstraction.
 * Group: cg:auditor. Idempotency via event_receipts; optional event_bus_audit when EVENTS_AUDIT_TO_PG=true.
 *
 *   node scripts/events-domain-consumer.js
 *   EVENTS_AUDIT_TO_PG=true node scripts/events-domain-consumer.js
 */

require("dotenv").config();

const os = require("os");
const pg = require("../infra/postgres");
const { createStreamConsumer } = require("../control/stream-consumer");

const streamKey = process.env.EVENTS_STREAM_DOMAIN || "events.domain";
const auditToPg = /^1|true|yes|on$/i.test(process.env.EVENTS_AUDIT_TO_PG || "");
const consumerName = process.env.EVENTS_CONSUMER_NAME || `auditor-${os.hostname()}-${process.pid}`;

const consumer = createStreamConsumer({
  stream: streamKey,
  group: "cg:auditor",
  consumer: consumerName,
  blockMs: parseInt(process.env.EVENTS_CONSUMER_BLOCK_MS || "5000", 10),
  readCount: Math.min(50, Math.max(1, parseInt(process.env.EVENTS_CONSUMER_READ_COUNT || "10", 10))),
  concurrency: Math.min(10, Math.max(1, parseInt(process.env.EVENTS_CONSUMER_CONCURRENCY || "3", 10))),
  claimIdleMs: parseInt(process.env.EVENTS_CLAIM_IDLE_MS || "60000", 10),
  maxDeliveries: parseInt(process.env.EVENTS_MAX_DELIVERIES || "5", 10),
  dedupe: { mode: "db" },
  handler: async (evt) => {
    console.log(`[events.domain] ${evt.event_type} (${evt.domain}) ${evt.stream_id}`);
    if (auditToPg) {
      try {
        await pg.query(
          `INSERT INTO event_bus_audit
             (stream_key, stream_id, event_type, domain, payload_json, occurred_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
           ON CONFLICT (stream_key, stream_id) DO NOTHING`,
          [
            streamKey,
            evt.stream_id,
            evt.event_type,
            evt.domain,
            JSON.stringify(evt.payload || {}),
            evt.occurred_at || null,
          ]
        );
      } catch (e) {
        console.warn("[events.domain] audit insert failed:", e.message);
      }
    }
    return { status: "ok" };
  },
});

consumer.run().catch((err) => {
  console.error(err);
  process.exit(1);
});

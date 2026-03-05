#!/usr/bin/env node
"use strict";

/**
 * events.domain spawner consumer: maps events to tasks via event-task-mapper,
 * rate-limits with shouldSpawnTask, creates tasks with createTaskFromEvent.
 * Group: cg:spawner (separate from cg:auditor).
 *
 *   node scripts/events-domain-spawner.js
 */

require("dotenv").config();

const os = require("os");
const { createStreamConsumer } = require("../control/stream-consumer");
const { getTaskSpecForEvent, shouldSpawnTask } = require("../control/event-task-mapper");
const { createTaskFromEvent } = require("../control/event-spawn-task");

const streamKey = process.env.EVENTS_STREAM_DOMAIN || "events.domain";
const consumerName = process.env.EVENTS_SPAWNER_CONSUMER_NAME || `spawner-${os.hostname()}-${process.pid}`;

const consumer = createStreamConsumer({
  stream: streamKey,
  group: "cg:spawner",
  consumer: consumerName,
  blockMs: parseInt(process.env.EVENTS_SPAWNER_BLOCK_MS || "5000", 10),
  readCount: Math.min(20, Math.max(1, parseInt(process.env.EVENTS_SPAWNER_READ_COUNT || "5", 10))),
  concurrency: Math.min(5, Math.max(1, parseInt(process.env.EVENTS_SPAWNER_CONCURRENCY || "2", 10))),
  claimIdleMs: parseInt(process.env.EVENTS_CLAIM_IDLE_MS || "60000", 10),
  maxDeliveries: parseInt(process.env.EVENTS_MAX_DELIVERIES || "5", 10),
  dedupe: { mode: "db" },
  handler: async (evt) => {
    const spec = getTaskSpecForEvent(evt.event_type);
    if (!spec) {
      return { status: "skip", reason: "no_mapping" };
    }
    const allowed = await shouldSpawnTask(evt.event_type, evt.idempotency_key || evt.event_id || evt.stream_id);
    if (!allowed) {
      return { status: "skip", reason: "rate_limited" };
    }
    try {
      await createTaskFromEvent(spec.taskType, evt.payload || {}, spec.priority, evt.idempotency_key || evt.event_id);
      return { status: "ok" };
    } catch (err) {
      console.warn(`[spawner] createTaskFromEvent failed: ${err.message}`);
      return { status: "retry", reason: err.message };
    }
  },
});

consumer.run().catch((err) => {
  console.error(err);
  process.exit(1);
});

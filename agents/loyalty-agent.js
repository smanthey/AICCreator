"use strict";

const pg = require("../infra/postgres");
const { register } = require("./registry");
const { enqueueWebhook, processQueuedWebhooks } = require("../control/loyalty/engine");
const { processOutreachQueue } = require("../control/loyalty/outreach");

register("loyalty_webhook_ingest", async (payload = {}) => {
  const provider = payload.provider || "unknown";
  const eventType = payload.event_type || payload.type || "unknown";
  const eventId = payload.event_id || payload.id || null;
  const signatureValid = payload.signature_valid !== false;
  const body = payload.payload || {};

  const row = await enqueueWebhook(pg, {
    provider,
    eventType,
    eventId,
    signatureValid,
    payload: body,
  });

  return {
    event_row_id: row.id,
    status: row.processing_status,
    provider,
    event_type: eventType,
    cost_usd: 0,
    model_used: "deterministic",
  };
});

register("loyalty_process_webhooks", async (payload = {}) => {
  const limit = Math.max(1, Number(payload.limit || 200));
  const res = await processQueuedWebhooks(pg, limit);
  return { ...res, cost_usd: 0, model_used: "deterministic" };
});

register("loyalty_send_outreach", async (payload = {}) => {
  const limit = Math.max(1, Number(payload.limit || 200));
  const res = await processOutreachQueue(pg, limit);
  return { ...res, cost_usd: 0, model_used: "deterministic" };
});

register("loyalty_maintenance", async (payload = {}) => {
  const webhookLimit = Math.max(1, Number(payload.webhook_limit || 500));
  const outreachLimit = Math.max(1, Number(payload.outreach_limit || 500));
  const webhooks = await processQueuedWebhooks(pg, webhookLimit);
  const outreach = await processOutreachQueue(pg, outreachLimit);
  return {
    webhooks,
    outreach,
    cost_usd: 0,
    model_used: "deterministic",
  };
});


#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { enqueueWebhook, processQueuedWebhooks } = require("../control/loyalty/engine");
const { processOutreachQueue } = require("../control/loyalty/outreach");

async function main() {
  const base = {
    customer: {
      id: "cust-smoke-001",
      email: process.env.LOYALTY_SMOKE_EMAIL || "shop@skynpatch.com",
      phone: process.env.LOYALTY_SMOKE_PHONE || null,
      first_name: "Smoke",
      last_name: "User",
      wallet_pass_id: "wallet-smoke-001",
    },
    order: {
      id: "order-smoke-001",
      total: 58.0,
      points_earned: 58,
    },
  };

  await enqueueWebhook(pg, {
    provider: "dutchie",
    eventType: "order.completed",
    eventId: `smoke-order-${Date.now()}`,
    signatureValid: true,
    payload: base,
  });

  await enqueueWebhook(pg, {
    provider: "wallet_pass",
    eventType: "wallet.pass.scanned",
    eventId: `smoke-pass-${Date.now()}`,
    signatureValid: true,
    payload: {
      member_id: "cust-smoke-001",
      wallet_pass_id: "wallet-smoke-001",
      points_earned: 5,
    },
  });

  const webhookRes = await processQueuedWebhooks(pg, 50);
  const outreachRes = await processOutreachQueue(pg, 50);

  const { rows } = await pg.query(
    `SELECT
       (SELECT COUNT(*)::int FROM loyalty_members) AS members,
       (SELECT COUNT(*)::int FROM loyalty_transactions) AS transactions,
       (SELECT COUNT(*)::int FROM loyalty_webhook_events WHERE processing_status='processed') AS webhooks_processed,
       (SELECT COUNT(*)::int FROM loyalty_outreach_queue WHERE status='sent') AS outreach_sent`
  );

  console.log("\n=== Loyalty Smoke Test ===\n");
  console.log(`webhooks queued=${webhookRes.queued} processed=${webhookRes.processed} failed=${webhookRes.failed}`);
  console.log(`outreach queued=${outreachRes.queued} sent=${outreachRes.sent} failed=${outreachRes.failed} skipped=${outreachRes.skipped}`);
  console.log(rows[0]);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });


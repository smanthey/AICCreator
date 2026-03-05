#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { enqueueWebhook, processQueuedWebhooks } = require("../control/loyalty/engine");
const { processOutreachQueue } = require("../control/loyalty/outreach");

async function main() {
  const stamp = Date.now();
  const cookiesEventId = `cookies-copy-${stamp}`;
  const nirvanaEventId = `nirvana-${stamp}`;

  await enqueueWebhook(pg, {
    provider: "wallet_pass",
    eventType: "wallet.pass.updated",
    eventId: nirvanaEventId,
    signatureValid: true,
    payload: {
      member_id: `member-nirvana-${stamp}`,
      wallet_pass_id: "CookiesPass-1",
      pass_name: "CookiesPass-1",
      points_earned: 10,
      email: process.env.LOYALTY_SMOKE_EMAIL || "shop@skynpatch.com",
    },
  });

  await enqueueWebhook(pg, {
    provider: "wallet_pass",
    eventType: "wallet.pass.updated",
    eventId: cookiesEventId,
    signatureValid: true,
    payload: {
      member_id: `member-cookies-${stamp}`,
      wallet_pass_id: "CookiesPass-1 copy",
      pass_name: "CookiesPass-1 copy",
      points_earned: 15,
      email: process.env.LOYALTY_SMOKE_EMAIL || "shop@skynpatch.com",
    },
  });

  const webhookRes = await processQueuedWebhooks(pg, 50);
  const outreachRes = await processOutreachQueue(pg, 50);

  const { rows } = await pg.query(
    `SELECT payload_json->>'wallet_pass_brand' AS brand, COUNT(*)::int AS n
     FROM loyalty_outreach_queue
     WHERE dedupe_key IN ($1,$2)
     GROUP BY 1
     ORDER BY 1`,
    [
      `wallet_pass:${cookiesEventId}:email:loyalty_points_update`,
      `wallet_pass:${nirvanaEventId}:email:loyalty_points_update`,
    ]
  );

  const { rows: sentOrder } = await pg.query(
    `SELECT dedupe_key, payload_json->>'wallet_pass_brand' AS brand, sent_at
     FROM loyalty_outreach_queue
     WHERE dedupe_key IN ($1,$2)
       AND status='sent'
     ORDER BY sent_at ASC`,
    [
      `wallet_pass:${cookiesEventId}:email:loyalty_points_update`,
      `wallet_pass:${nirvanaEventId}:email:loyalty_points_update`,
    ]
  );

  console.log("\n=== Loyalty Cookies Priority Test ===\n");
  console.log(`webhooks queued=${webhookRes.queued} processed=${webhookRes.processed} failed=${webhookRes.failed}`);
  console.log(`outreach queued=${outreachRes.queued} sent=${outreachRes.sent} failed=${outreachRes.failed} skipped=${outreachRes.skipped}`);
  console.log("brands:", rows);
  console.log("sent_order:", sentOrder);

  if (sentOrder.length >= 2 && sentOrder[0].brand !== "cookies") {
    throw new Error(`priority_failed:first_sent=${sentOrder[0].brand}`);
  }
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });


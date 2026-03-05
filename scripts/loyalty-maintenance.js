#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { processQueuedWebhooks } = require("../control/loyalty/engine");
const { processOutreachQueue } = require("../control/loyalty/outreach");

async function main() {
  const start = new Date();
  console.log(`[loyalty-maintenance] started ${start.toISOString()}`);

  const webhookRes = await processQueuedWebhooks(pg, 500);
  const outreachRes = await processOutreachQueue(pg, 500);

  const end = new Date();
  console.log(`[loyalty-maintenance] webhooks queued=${webhookRes.queued} processed=${webhookRes.processed} failed=${webhookRes.failed}`);
  console.log(`[loyalty-maintenance] outreach queued=${outreachRes.queued} sent=${outreachRes.sent} failed=${outreachRes.failed} skipped=${outreachRes.skipped}`);
  console.log(`[loyalty-maintenance] completed ${end.toISOString()}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("[loyalty-maintenance] fatal:", err.message);
    await pg.end();
    process.exit(1);
  });


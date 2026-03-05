#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { processQueuedWebhooks } = require("../control/loyalty/engine");

const args = process.argv.slice(2);
const getArg = (k, d = null) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};

const LIMIT = Math.max(1, Number(getArg("--limit", "200")) || 200);

async function main() {
  const res = await processQueuedWebhooks(pg, LIMIT);
  console.log("\n=== Loyalty Webhook Processor ===\n");
  console.log(`queued:    ${res.queued}`);
  console.log(`processed: ${res.processed}`);
  console.log(`failed:    ${res.failed}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });


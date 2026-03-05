#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { processOutreachQueue } = require("../control/loyalty/outreach");

const args = process.argv.slice(2);
const getArg = (k, d = null) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};

const LIMIT = Math.max(1, Number(getArg("--limit", "200")) || 200);

async function main() {
  const res = await processOutreachQueue(pg, LIMIT);
  console.log("\n=== Loyalty Outreach Sender ===\n");
  console.log(`queued:  ${res.queued}`);
  console.log(`sent:    ${res.sent}`);
  console.log(`failed:  ${res.failed}`);
  console.log(`skipped: ${res.skipped}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });


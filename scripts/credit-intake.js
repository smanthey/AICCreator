#!/usr/bin/env node
"use strict";

require("dotenv").config();

const path = require("path");
const pg = require("../infra/postgres");
const { ingestCreditJson } = require("../control/credit/intake");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const personKey = getArg("--person-key");
const filePath = getArg("--file");
const bureau = getArg("--bureau", null);
const reportDate = getArg("--date", null);

async function main() {
  if (!personKey || !filePath) {
    throw new Error("Usage: node scripts/credit-intake.js --person-key <key> --file <json-path> [--bureau experian] [--date YYYY-MM-DD]");
  }

  const result = await ingestCreditJson({
    filePath: path.resolve(filePath),
    personKey,
    reportOverride: {
      ...(bureau ? { bureau } : {}),
      ...(reportDate ? { report_date: reportDate } : {}),
    },
  });

  console.log("\n=== Credit Intake ===\n");
  console.log(`person_key:     ${result.person_key}`);
  console.log(`person_id:      ${result.person_id}`);
  console.log(`report_id:      ${result.report_id}`);
  console.log(`bureau:         ${result.bureau}`);
  console.log(`report_date:    ${result.report_date}`);
  console.log(`items_inserted: ${result.items_inserted}`);
  console.log(`source_hash:    ${result.source_hash}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

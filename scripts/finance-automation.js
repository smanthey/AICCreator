#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { runSubscriptionAudit, runTaxPrepAutomation } = require("../control/finance-ops");

const args = process.argv.slice(2);
const cmd = (args[0] || "help").toLowerCase();

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function has(flag) {
  return args.includes(flag);
}

(async () => {
  try {
    if (cmd === "subscription:audit") {
      const out = await runSubscriptionAudit({
        days_back: Number(arg("--days-back", "180")) || 180,
        max_email_scan: Number(arg("--max-email-scan", "120")) || 120,
        dry_run: has("--dry-run"),
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "tax:prep") {
      const out = await runTaxPrepAutomation({
        year: Number(arg("--year", String(new Date().getFullYear()))) || new Date().getFullYear(),
        days_back: Number(arg("--days-back", "365")) || 365,
        dry_run: has("--dry-run"),
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    console.log(`Finance Automation\n\nCommands:\n  subscription:audit [--days-back 180] [--max-email-scan 120] [--dry-run]\n  tax:prep [--year ${new Date().getFullYear()}] [--days-back 365] [--dry-run]\n`);
  } catch (err) {
    console.error("[finance-automation] fatal:", err.message || String(err));
    process.exit(1);
  }
})();

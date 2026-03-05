#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const SEND_TEST_EMAILS = ["1", "true", "yes", "on"].includes(
  String(process.env.SALESOPS_SEND_TEST_EMAILS || "").toLowerCase()
);
const TEST_TO = process.env.SALESOPS_TEST_TO || "shop@skynpatch.com";
const TEST_VARIANTS = (process.env.SALESOPS_TEST_VARIANTS || "margin,sellthru")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function run(script, args = []) {
  const full = path.join(__dirname, script);
  console.log(`[salesops] $ node ${full} ${args.join(" ")}`.trim());
  const res = spawnSync("node", [full, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`${script} failed with code ${res.status}`);
  }
}

async function main() {
  console.log("[salesops] maintenance start");
  run("stripe-add-skus.js");
  run("stripe-update-checkout.js");
  run("sales-webhook-replay.js", ["--brand", "skynpatch", "--limit", "3"]);
  run("sales-daily-conversion-report.js", ["--brand", "skynpatch", "--days", "1"]);
  run("sales-attribution-qa.js", ["--brand", "skynpatch", "--days", "30"]);
  if (SEND_TEST_EMAILS) {
    run("send-test-email.js", ["--to", TEST_TO, "--variant", TEST_VARIANTS[0] || "margin"]);
    if (TEST_VARIANTS[1]) {
      run("send-test-email.js", ["--to", TEST_TO, "--variant", TEST_VARIANTS[1]]);
    }
  } else {
    console.log("[salesops] test email send disabled (SALESOPS_SEND_TEST_EMAILS=false)");
  }
  console.log("[salesops] maintenance complete");
}

main().catch((err) => {
  console.error("[salesops] fatal:", err.message);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f, fallback = null) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : fallback;
};

const DRY_RUN = hasFlag("--dry-run");
const PERSON_KEY = getArg("--person-key", "");
const SEND_LIMIT = Math.max(1, Number(getArg("--send-limit", "25")) || 25);
const REPLY_LIMIT = Math.max(1, Number(getArg("--reply-limit", "50")) || 50);
const EVIDENCE_ROOT = getArg("--evidence-root", process.env.CREDIT_EVIDENCE_ROOT || "");

function run(cmd, argv = [], opts = {}) {
  const res = spawnSync(cmd, argv, {
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${argv.join(" ")} failed with code ${res.status}`);
  }
}

async function main() {
  console.log("[credit-e2e-live-loop] start");

  if (!DRY_RUN) {
    run("node", ["scripts/credit-oauth-check.js"]);
  }

  const autopilotArgs = [
    "scripts/credit-autopilot.js",
    "--limit-profiles", "200",
    "--limit-deadlines", "200",
  ];
  if (PERSON_KEY) autopilotArgs.push("--person-key", PERSON_KEY);
  if (EVIDENCE_ROOT) autopilotArgs.push("--evidence-root", EVIDENCE_ROOT);
  if (DRY_RUN) autopilotArgs.push("--dry-run");
  run("node", autopilotArgs);

  for (const channel of ["bureau", "furnisher", "collector"]) {
    const sendArgs = ["scripts/credit-send-queued.js", "--channel", channel, "--limit", String(SEND_LIMIT)];
    if (DRY_RUN) sendArgs.push("--dry-run");
    run("node", sendArgs);
  }

  const syncArgs = [
    "scripts/credit-sync-replies.js",
    "--limit", String(REPLY_LIMIT),
    "--auto-log-outcome",
    "--outcome-result", "partially_won",
    "--outcome-score-delta", "5",
  ];
  if (DRY_RUN) syncArgs.push("--dry-run");
  run("node", syncArgs);

  run("node", ["scripts/credit-learning-report.js"]);
  run("node", ["scripts/credit-next-actions.js", ...(PERSON_KEY ? ["--person-key", PERSON_KEY] : [])]);

  console.log("[credit-e2e-live-loop] complete");
}

main().catch((err) => {
  console.error("[credit-e2e-live-loop] fatal:", err.message);
  process.exit(1);
});

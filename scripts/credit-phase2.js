#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const dryRun = hasFlag("--dry-run");
const personKey = getArg("--person-key", "");
const monthlyBudget = getArg("--monthly-budget", "");
const limitProfiles = getArg("--limit-profiles", process.env.CREDIT_AUTOPILOT_LIMIT_PROFILES || "100");
const limitDeadlines = getArg("--limit-deadlines", process.env.CREDIT_AUTOPILOT_LIMIT_DEADLINES || "100");

function runStep(label, command, commandArgs) {
  console.log(`\n[credit:phase2] ▶ ${label}`);
  const res = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`step_failed:${label}`);
  }
}

function buildAutopilotArgs() {
  const out = ["run", "credit:autopilot", "--", "--limit-profiles", String(limitProfiles), "--limit-deadlines", String(limitDeadlines)];
  if (dryRun) out.push("--dry-run");
  if (personKey) out.push("--person-key", personKey);
  if (monthlyBudget) out.push("--monthly-budget", monthlyBudget);
  return out;
}

function buildNextActionsArgs() {
  const out = ["run", "credit:next-actions", "--", "--limit", String(limitDeadlines)];
  if (personKey) out.push("--person-key", personKey);
  if (!dryRun) out.push("--create-tasks");
  return out;
}

function main() {
  const startedAt = new Date();
  console.log(`[credit:phase2] start ${startedAt.toISOString()} dry_run=${dryRun} person_key=${personKey || "(all)"}`);

  runStep("credit-kb-validate", "npm", ["run", "credit:kb:validate"]);
  runStep("credit-autopilot", "npm", buildAutopilotArgs());
  if (!dryRun) {
    runStep("credit-send-queued", "npm", ["run", "credit:send-queued", "--", "--limit", String(limitDeadlines)]);
    runStep("credit-sync-replies", "npm", ["run", "credit:sync-replies", "--", "--limit", String(limitDeadlines)]);
  }
  runStep("credit-next-actions", "npm", buildNextActionsArgs());
  runStep("credit-learning-report", "npm", ["run", "credit:learning:report"]);

  const endedAt = new Date();
  console.log(`\n[credit:phase2] done ${endedAt.toISOString()}`);
  console.log("[credit:phase2] complete: deterministic checks, action generation, task queueing, and learning report all passed.");
}

try {
  main();
} catch (err) {
  console.error(`[credit:phase2] fatal: ${err.message}`);
  process.exit(1);
}

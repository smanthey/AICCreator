#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { enqueueClosedLoopChain } = require("../control/closed-loop");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

async function main() {
  const repo = String(arg("--repo", "local/quantfusion")).trim();
  const featureKey = String(arg("--feature-key", "symbol_failure_mapping")).trim();
  const source = String(arg("--source", "manual_closed_loop")).trim();
  const objective = String(
    arg("--objective", "Run 8-step self-correcting engineering loop and ship 1-2 concrete upgrades.")
  ).trim();
  const qualityTarget = Math.max(1, Math.min(100, Number(arg("--quality-target", "92")) || 92));

  const result = await enqueueClosedLoopChain({
    repo,
    feature_key: featureKey,
    source,
    objective,
    quality_target: qualityTarget,
  });

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main()
  .catch((err) => {
    console.error("[closed-self-correct-loop] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });


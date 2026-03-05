#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { enqueueClosedLoopChain } = require("../control/closed-loop");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "closed-loop-daily-latest.json");

const TARGETS = String(
  process.env.CLOSED_LOOP_DAILY_TARGETS ||
    "local/quantfusion:cdp_network_contracts,local/quantfusion:symbol_failure_mapping,local/payclaw:auto_wait_stability,local/CookiesPass:wallet_pass_and_loyalty_flow,local/TempeCookiesPass:tempe_variant_stability,local/claw-architect:symbol_failure_mapping"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

function parseTarget(line) {
  const [repoRaw, featureRaw] = String(line).split(":");
  return {
    repo: (repoRaw || "").trim(),
    featureKey: (featureRaw || "general").trim(),
  };
}

async function main() {
  const runDate = new Date().toISOString().slice(0, 10);
  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    run_date: runDate,
    targets: [],
  };

  for (const t of TARGETS.map(parseTarget)) {
    if (!t.repo) continue;
    const objective =
      `Daily closed-loop run for ${t.repo} (${t.featureKey}). ` +
      `Follow 8-step self-correcting flow, ship concrete improvements with retest evidence, and require a same-day meaningful commit/push when code changes are produced.`;
    const result = await enqueueClosedLoopChain({
      repo: t.repo,
      feature_key: t.featureKey,
      source: "closed_loop_daily",
      objective,
      run_date: runDate,
      quality_target: 92,
    });
    report.targets.push({
      repo: t.repo,
      feature_key: t.featureKey,
      ...result,
    });
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[closed-loop-daily] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

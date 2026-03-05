#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const { getOutcomeStats, computeWeightedScore } = require("../control/ip/rules-harness");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const REPORT = getArg("--report", null);
const approvalWeight = Number(getArg("--approval-weight", "0.5"));
const cycleWeight = Number(getArg("--cycle-weight", "0.3"));
const scopeWeight = Number(getArg("--scope-weight", "1.0"));
const feeWeight = Number(getArg("--fee-weight", "1.0"));
const OUT_DIR = path.join(process.cwd(), "scripts", "ip-rules-reports");

function loadReport(file) {
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const outcomeStats = await getOutcomeStats();
  const weighted = computeWeightedScore(outcomeStats, {
    approval_weight: approvalWeight,
    cycle_weight: cycleWeight,
    scope_weight: scopeWeight,
    fee_weight: feeWeight,
  });

  const report = loadReport(REPORT);
  const simQuality = report ? {
    doc_macro_f1: report?.proposed?.doc_type_macro?.f1 ?? null,
    issue_macro_f1: report?.proposed?.issue_macro?.f1 ?? null,
    deadline_consistency: report?.proposed?.deadline_consistency?.consistency ?? null,
    delta: report?.delta ?? null,
  } : null;

  const output = {
    generated_at: new Date().toISOString(),
    source_report: REPORT,
    outcome_stats: outcomeStats,
    weighted,
    simulation_quality: simQuality,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${Date.now()}-score.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`[ip-rules-score] wrote ${outPath}`);
  console.log(`[ip-rules-score] score=${weighted.score} approval=${weighted.approval} speed=${weighted.speed} scope_penalty=${weighted.scope_penalty} fee_penalty=${weighted.fee_penalty}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

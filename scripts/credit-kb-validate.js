#!/usr/bin/env node
"use strict";

const { loadComplianceKb } = require("../control/credit/compliance-kb");

function main() {
  const kb = loadComplianceKb();
  const failures = [];
  const warnings = [];

  if (!Array.isArray(kb.laws) || kb.laws.length < 4) {
    failures.push("laws set incomplete");
  }

  const lawCodes = new Set((kb.laws || []).map((l) => l.code));
  for (const c of ["FCRA", "FDCPA", "FACTA", "ECOA"]) {
    if (!lawCodes.has(c)) failures.push(`missing law code ${c}`);
  }

  const workflowNames = new Set((kb.workflows || []).map((w) => w.workflow));
  for (const w of ["bureau_dispute", "furnisher_dispute", "debt_validation", "goodwill_request", "cfpb_escalation"]) {
    if (!workflowNames.has(w)) warnings.push(`missing workflow ${w}`);
  }

  for (const wf of kb.workflows || []) {
    const allowedByPolicy = (kb.allowedActions || {})[wf.workflow];
    if (!allowedByPolicy) warnings.push(`workflow ${wf.workflow} not represented in allowed_actions`);
  }

  if (!kb.prohibitedActions || !Array.isArray(kb.prohibitedActions.global)) {
    failures.push("prohibited actions malformed");
  }

  if (failures.length) {
    console.log("\n=== Credit KB Validation ===\n");
    for (const f of failures) console.log(`FAIL: ${f}`);
    for (const w of warnings) console.log(`WARN: ${w}`);
    process.exit(1);
  }

  console.log("\n=== Credit KB Validation ===\n");
  console.log(`laws: ${kb.laws.length}`);
  console.log(`workflows: ${kb.workflows.length}`);
  console.log(`policy actions: ${Object.keys(kb.allowedActions || {}).length}`);
  console.log(`issue evidence map: ${Object.keys(kb.issueEvidence || {}).length}`);
  for (const w of warnings) console.log(`WARN: ${w}`);
  console.log("OK");
}

main();


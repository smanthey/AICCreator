#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const {
  getActiveRules,
  loadProposalFromFile,
  buildPatchedRules,
  simulateAgainstRules,
  getPatchBeforeAfter,
} = require("../control/ip/rules-harness");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const PROPOSAL = getArg("--proposal", null);
const LIMIT_DOCS = Math.max(50, Number(getArg("--limit-docs", "2000")) || 2000);
const LIMIT_ISSUES = Math.max(50, Number(getArg("--limit-issues", "5000")) || 5000);
const LIMIT_DEADLINES = Math.max(50, Number(getArg("--limit-deadlines", "2000")) || 2000);
const OUT_DIR = path.join(process.cwd(), "scripts", "ip-rules-reports");

async function main() {
  const active = await getActiveRules();
  let patchedRules = active.rules;
  let patchOps = [];
  let patchPreview = [];

  if (PROPOSAL) {
    const loaded = loadProposalFromFile(PROPOSAL);
    patchOps = loaded.ops;
    patchedRules = buildPatchedRules(active.rules, patchOps);
    patchPreview = getPatchBeforeAfter(active.rules, patchOps);
  }

  const [baseline, proposed] = await Promise.all([
    simulateAgainstRules(active.rules, { limitDocs: LIMIT_DOCS, limitIssues: LIMIT_ISSUES, limitDeadlines: LIMIT_DEADLINES }),
    simulateAgainstRules(patchedRules, { limitDocs: LIMIT_DOCS, limitIssues: LIMIT_ISSUES, limitDeadlines: LIMIT_DEADLINES }),
  ]);

  const report = {
    generated_at: new Date().toISOString(),
    base_rule_set_version: active.version,
    proposal_file: PROPOSAL || null,
    patch_count: patchOps.length,
    patch_preview: patchPreview,
    baseline,
    proposed,
    delta: {
      doc_accuracy: Number((proposed.doc_accuracy - baseline.doc_accuracy).toFixed(3)),
      doc_macro_f1: Number((proposed.doc_type_macro.f1 - baseline.doc_type_macro.f1).toFixed(3)),
      issue_macro_f1: Number((proposed.issue_macro.f1 - baseline.issue_macro.f1).toFixed(3)),
      deadline_consistency: Number((proposed.deadline_consistency.consistency - baseline.deadline_consistency.consistency).toFixed(3)),
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${Date.now()}-simulate-v${active.version}${PROPOSAL ? "-proposal" : "-baseline"}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`[ip-rules-simulate] wrote ${outPath}`);
  console.log(`[ip-rules-simulate] docs=${baseline.docs_scanned} patch_ops=${patchOps.length}`);
  console.log(`[ip-rules-simulate] delta doc_f1=${report.delta.doc_macro_f1} issue_f1=${report.delta.issue_macro_f1} deadline=${report.delta.deadline_consistency}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

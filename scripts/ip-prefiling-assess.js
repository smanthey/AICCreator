#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { assessPrefiling, saveAssessment } = require("../control/ip/prefiling");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const markText = getArg("--mark");
const goodsText = getArg("--goods", "");
const classesRaw = getArg("--classes", "");
const markCategory = getArg("--category", null);
const filingBasis = String(getArg("--basis", "unknown")).toLowerCase();
const SAVE = !hasFlag("--no-save");

function parseClasses(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 100);
}

function pct(v) {
  return `${Math.round(Number(v || 0) * 100)}`;
}

function printPanel(assessment, saved) {
  console.log("\n=== IP Pre-Filing Risk Panel ===\n");
  console.log(`Mark: ${assessment.mark_text}`);
  console.log(`Basis: ${assessment.filing_basis}`);
  console.log(`Classes: ${assessment.class_numbers.join(", ") || "(none)"}`);
  console.log(`Category: ${assessment.mark_category || "(none)"}`);
  console.log("");
  console.log(`2(d) risk: ${pct(assessment.risk_2d)}/100`);
  console.log(`2(e)(1) risk: ${pct(assessment.risk_2e1)}/100`);
  console.log(`ID indefiniteness risk: ${pct(assessment.risk_id_indefinite)}/100`);
  console.log(`Specimen risk: ${pct(assessment.risk_specimen)}/100`);
  console.log(`Predicted cycles to allowance: ${assessment.predicted_cycles}`);
  console.log(`Borderline classification: ${assessment.borderline_classification} (${pct(assessment.borderline_confidence)}% conf)`);
  console.log("");
  console.log(`Recommended strategy: ${assessment.recommended_strategy}`);
  console.log(`Early class split recommended: ${assessment.recommended_split ? "yes" : "no"}`);
  console.log("");
  console.log("Top drivers:");
  for (const d of assessment.top_drivers || []) {
    console.log(`- ${d.key}: ${d.value}`);
  }

  console.log("\nStrategy options:");
  for (const opt of assessment.strategy_options || []) {
    console.log(`- ${opt.key}: fit=${pct(opt.fit)}% cycles=${opt.expected_cycles} months~${Math.round(opt.expected_months)} fee_x=${opt.expected_fee_multiplier} scope_impact=${opt.scope_impact}`);
  }

  if ((assessment.conflict_candidates || []).length) {
    console.log("\nTop conflict candidates:");
    for (const c of assessment.conflict_candidates.slice(0, 5)) {
      console.log(`- ${c.case_key || c.case_id}: ${c.mark} | sim=${c.similarity} class_overlap=${c.class_overlap}`);
    }
  }

  if (saved) {
    console.log(`\nSaved assessment: ${saved.id} (${saved.created_at})`);
  }
}

async function main() {
  if (!markText) {
    throw new Error("Required: --mark \"MARK\" --classes \"25,42\" [--goods \"...\"] [--category apparel] [--basis 1a|1b]");
  }

  const classNumbers = parseClasses(classesRaw);
  if (!classNumbers.length) {
    throw new Error("--classes must include at least one class number, e.g. --classes \"25,42\"");
  }

  const assessment = await assessPrefiling({
    markText,
    goodsText,
    classNumbers,
    markCategory,
    filingBasis,
  });

  let saved = null;
  if (SAVE) {
    saved = await saveAssessment(assessment);
  }

  printPanel(assessment, saved);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

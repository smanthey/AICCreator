#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function getArg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

const summary = getArg("--summary", "Significant change");
const project = getArg("--project", "claw-architect");
const ownerResponded = hasFlag("--owner-responded");

const timestamp = new Date().toISOString();
const date = timestamp.slice(0, 10);
const safeProject = project.replace(/[^a-zA-Z0-9._-]+/g, "_");

const defaults = {
  mode: "safe-defaults",
  dry_run: true,
  read_only: true,
  destructive_actions: "disabled",
};

const checklist = {
  success_criteria: [
    "Outcomes are measurable and testable.",
    "No launch-critical tests fail or skip.",
    "Operational docs/runbooks updated for changed behavior.",
  ],
  constraints: [
    "Safety: no destructive operations without explicit confirmation.",
    "Time: keep first pass scoped to highest-impact path.",
    "Scope: avoid unrelated refactors in same change set.",
  ],
  failure_modes: [
    "False-green status due to skipped critical checks.",
    "Schema/contract mismatch between producer and consumer.",
    "Policy bypass on mutating task paths.",
    "Queue lag from over-broad task fanout.",
  ],
  approach: [
    "1) Define objective + affected components.",
    "2) Add/update tests for edge cases + policy/schema.",
    "3) Implement smallest safe patch.",
    "4) Verify with targeted tests, then global status.",
    "5) Update docs/context and changelog.",
  ],
};

const outDir = path.join(os.homedir(), "notes", "dev", "alignment");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${date}_${safeProject}_alignment-gate.md`);

const lines = [
  "# Alignment Gate",
  "",
  `- timestamp: ${timestamp}`,
  `- project: ${project}`,
  `- summary: ${summary}`,
  `- owner_responded: ${ownerResponded ? "yes" : "no"}`,
  "",
  "## 1) Success Criteria",
  ...checklist.success_criteria.map((v) => `- ${v}`),
  "",
  "## 2) Constraints (Safety, Time, Scope)",
  ...checklist.constraints.map((v) => `- ${v}`),
  "",
  "## 3) Failure Modes",
  ...checklist.failure_modes.map((v) => `- ${v}`),
  "",
  "## 4) Approach (Tasks + Order)",
  ...checklist.approach.map((v) => `- ${v}`),
  "",
  "## Default Mode (when no response)",
  ...(ownerResponded
    ? ["- Owner responded. Safe defaults can be relaxed case-by-case."]
    : [
        `- mode: ${defaults.mode}`,
        `- dry_run: ${defaults.dry_run}`,
        `- read_only: ${defaults.read_only}`,
        `- destructive_actions: ${defaults.destructive_actions}`,
      ]),
  "",
  "## Decision",
  ...(ownerResponded
    ? ["- Proceed with agreed plan and explicit confirmations where required."]
    : ["- Proceed immediately with safe defaults (dry-run, read-only, no destructive actions)."]),
  "",
];

fs.writeFileSync(outPath, lines.join("\n"));

console.log("✅ Alignment gate recorded");
console.log(`file: ${outPath}`);
if (!ownerResponded) {
  console.log("mode: safe-defaults (dry-run + read-only + no destructive actions)");
}

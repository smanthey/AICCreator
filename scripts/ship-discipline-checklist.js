#!/usr/bin/env node
"use strict";

const items = [
  "Refactor pain points are named and addressed.",
  "Tests added/updated (schema, policy, edge cases).",
  "Docs updated in docs/ (architecture).",
  "Runbook updated in context/ (operations).",
  "Schema notes updated in schemas/ (if payload changed).",
  "Entry appended to ~/notes/dev/CHANGELOG.md with changes + risks.",
];

console.log("=== Ship Discipline Checklist ===");
items.forEach((item, i) => console.log(`${i + 1}. ${item}`));
console.log("\nBlock merge/release if any item is incomplete.");

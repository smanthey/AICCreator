#!/usr/bin/env node
"use strict";

const { addFeedback } = require("../control/agent-memory");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

async function main() {
  const agent = String(arg("--agent", "shared")).trim().toLowerCase();
  const text = String(arg("--text", "")).trim();
  const source = String(arg("--source", "manual")).trim();

  if (!text) throw new Error("--text is required");

  const out = await addFeedback({ agent, text, source });
  console.log(`feedback logged to ${out.feedback_file}`);
  console.log(`memory updated at ${out.memory_file}`);
}

main().catch((err) => {
  console.error(`agent-feedback-add failed: ${err.message}`);
  process.exit(1);
});

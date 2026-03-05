#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { TASK_ROUTING } = require("../config/task-routing");
const { SCHEMAS } = require("../schemas/payloads");
const { getRegisteredTypes } = require("../agents/registry");

function loadHandlers() {
  require("../agents/echo-agent");
  require("../agents/index-agent");
  require("../agents/classify-agent");
  require("../agents/report-agent");
  require("../agents/qa-agent");
  require("../agents/triage-agent");
  require("../agents/patch-agent");
  require("../agents/dedupe-agent");
  require("../agents/migrate-agent");
  require("../agents/claw-agent");
  require("../agents/orchestrator");
  require("../agents/github-sync-agent");
  require("../agents/site-audit-agent");
  require("../agents/media-detect-agent");
  require("../agents/media-enrich-agent");
  require("../agents/media-hash-agent");
  require("../agents/cluster-agent");
  require("../agents/stub-agents");
}

function diff(left, right) {
  return [...left].filter((k) => !right.has(k)).sort();
}

function main() {
  loadHandlers();

  const registered = new Set(getRegisteredTypes());
  const routing = new Set(Object.keys(TASK_ROUTING));
  const schemas = new Set(Object.keys(SCHEMAS));

  const missingRouting = diff(registered, routing);
  const missingSchema = diff(registered, schemas);
  const orphanRouting = diff(routing, registered);
  const orphanSchema = diff(schemas, registered);

  console.log("\n=== Task Contract Audit ===\n");
  console.log(`registered handlers : ${registered.size}`);
  console.log(`routing entries     : ${routing.size}`);
  console.log(`payload schemas     : ${schemas.size}`);

  if (missingRouting.length) {
    console.log(`\nMissing routing for registered handlers (${missingRouting.length}):`);
    for (const t of missingRouting) console.log(`- ${t}`);
  }

  if (missingSchema.length) {
    console.log(`\nMissing payload schema for registered handlers (${missingSchema.length}):`);
    for (const t of missingSchema) console.log(`- ${t}`);
  }

  if (orphanRouting.length) {
    console.log(`\nRouting entries with no registered handler (${orphanRouting.length}):`);
    for (const t of orphanRouting) console.log(`- ${t}`);
  }

  if (orphanSchema.length) {
    console.log(`\nPayload schemas with no registered handler (${orphanSchema.length}):`);
    for (const t of orphanSchema) console.log(`- ${t}`);
  }

  if (!missingRouting.length && !missingSchema.length && !orphanRouting.length && !orphanSchema.length) {
    console.log("\nOK: handlers, routing, and payload schemas are aligned.");
    process.exit(0);
  }

  // Hard fail only on contract gaps that can break dispatch/runtime.
  if (missingRouting.length || missingSchema.length) {
    console.error("\nFAIL: critical task contract gaps found.");
    process.exit(1);
  }

  console.log("\nWARN: non-critical orphans found.");
  process.exit(0);
}

main();

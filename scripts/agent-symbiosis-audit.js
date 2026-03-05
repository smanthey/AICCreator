#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { TASK_ROUTING, TAG_TAXONOMY } = require("../config/task-routing");
const { SCHEMAS } = require("../schemas/payloads");
const { getRegisteredTypes } = require("../agents/registry");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "agent-symbiosis-audit-latest.json");
const MISSION_PATH = path.join(ROOT, "config", "mission-control-agents.json");
const STATUS_REVIEW_PATH = path.join(ROOT, "config", "status-review-agents.json");

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
  require("../agents/repo-autofix-agent");
  require("../agents/opencode-controller-agent");
  require("../agents/brand-provision-agent");
  require("../agents/media-detect-agent");
  require("../agents/media-enrich-agent");
  require("../agents/media-hash-agent");
  require("../agents/media-visual-agent");
  require("../agents/cluster-agent");
  require("../agents/resourceful-file-resolve-agent");
  require("../agents/report-refresh-agent");
  require("../agents/quantfusion-trading-agent");
  require("../agents/stub-agents");
  require("../agents/content-agent");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function diff(left, right) {
  return [...left].filter((k) => !right.has(k)).sort();
}

function checkTagCoverage() {
  const unknownTags = new Set();
  for (const route of Object.values(TASK_ROUTING)) {
    for (const tag of route.required_tags || []) {
      if (!TAG_TAXONOMY.includes(tag)) unknownTags.add(tag);
    }
  }
  return [...unknownTags];
}

function checkMissionCoverage(ecosystemText, mission) {
  if (ecosystemText.includes("...MISSION_CONTROL_AGENT_APPS")) {
    return [];
  }
  const missing = [];
  for (const m of mission || []) {
    const pm2Name = `claw-mission-${m.id}`;
    if (!ecosystemText.includes(pm2Name)) {
      missing.push(pm2Name);
    }
  }
  return missing;
}

function checkStatusReviewCoverage(ecosystemText, statusAgents) {
  const missing = [];
  for (const a of statusAgents || []) {
    const needle = `--agent ${a.id}`;
    if (!ecosystemText.includes(needle)) {
      missing.push(a.id);
    }
  }
  return missing;
}

function countSignalEmitters() {
  const dirs = ["scripts", "control", "workers", "agents"];
  let count = 0;
  const files = [];
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(p);
          continue;
        }
        if (!p.endsWith(".js")) continue;
        const txt = readText(p);
        if (txt.includes("emitSignal(")) {
          count += 1;
          files.push(path.relative(ROOT, p));
        }
      }
    };
    walk(abs);
  }
  return { count, files: files.sort() };
}

function main() {
  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    findings: [],
    metrics: {},
  };

  loadHandlers();

  const registered = new Set(getRegisteredTypes());
  const routing = new Set(Object.keys(TASK_ROUTING));
  const schemas = new Set(Object.keys(SCHEMAS));

  const missingRouting = diff(registered, routing);
  const missingSchema = diff(registered, schemas);
  const orphanRouting = diff(routing, registered);
  const orphanSchema = diff(schemas, registered);

  report.metrics.registered_handlers = registered.size;
  report.metrics.routing_entries = routing.size;
  report.metrics.payload_schemas = schemas.size;

  if (missingRouting.length) {
    report.findings.push({ severity: "high", key: "missing_routing", detail: missingRouting });
  }
  if (missingSchema.length) {
    report.findings.push({ severity: "high", key: "missing_schema", detail: missingSchema });
  }
  if (orphanRouting.length) {
    report.findings.push({ severity: "medium", key: "orphan_routing", detail: orphanRouting });
  }
  if (orphanSchema.length) {
    report.findings.push({ severity: "medium", key: "orphan_schema", detail: orphanSchema });
  }

  const unknownTags = checkTagCoverage();
  if (unknownTags.length) {
    report.findings.push({ severity: "high", key: "unknown_required_tags", detail: unknownTags });
  }

  const ecosystemText = readText(path.join(ROOT, "ecosystem.background.config.js"));
  const mission = readJson(MISSION_PATH) || [];
  const statusReview = readJson(STATUS_REVIEW_PATH) || [];

  const missingMissionPm2 = checkMissionCoverage(ecosystemText, mission);
  if (missingMissionPm2.length) {
    report.findings.push({ severity: "medium", key: "missing_mission_pm2_names", detail: missingMissionPm2 });
  }

  const missingStatusReview = checkStatusReviewCoverage(ecosystemText, statusReview);
  if (missingStatusReview.length) {
    report.findings.push({ severity: "medium", key: "missing_status_review_pm2_agents", detail: missingStatusReview });
  }

  const signal = countSignalEmitters();
  report.metrics.signal_emitters = signal.count;
  report.metrics.signal_emitter_files = signal.files;
  if (!signal.files.some((f) => f === "workers/worker.js")) {
    report.findings.push({
      severity: "high",
      key: "missing_worker_signal_emission",
      detail: "workers/worker.js does not emit cross-agent signals",
    });
  }

  report.ok = !report.findings.some((f) => f.severity === "high");
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();

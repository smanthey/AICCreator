#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { logIntegrityEvent } = require("../control/integrity-events");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "agent-state", "shared-context", "management-integrity-state.json");
const REPORTS_DIR = path.join(ROOT, "reports");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeReport(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const latest = path.join(REPORTS_DIR, "integrity-quarantine-latest.json");
  const stamped = path.join(REPORTS_DIR, `integrity-quarantine-${Date.now()}.json`);
  fs.writeFileSync(latest, JSON.stringify(report, null, 2));
  fs.writeFileSync(stamped, JSON.stringify(report, null, 2));
  return { latest, stamped };
}

async function main() {
  const lane = String(arg("--lane", "")).trim().toLowerCase();
  const reason = String(arg("--reason", "")).trim();
  const requiredAction = String(
    arg(
      "--required-action",
      "Attach required evidence, resolve blocker, then run integrity:unquarantine with audited reason."
    )
  ).trim();
  const actor = String(arg("--by", process.env.USER || "system")).trim();

  if (!lane) {
    console.error("Usage: integrity:quarantine --lane <name> --reason <text> [--required-action <text>] [--by <actor>]");
    process.exit(1);
  }
  if (!reason || reason.length < 8) {
    console.error("A meaningful --reason is required (min 8 chars).");
    process.exit(1);
  }
  if (!/^[a-z0-9_-]+$/.test(lane)) {
    console.error("Lane must match /^[a-z0-9_-]+$/");
    process.exit(1);
  }

  const state = readJsonSafe(STATE_PATH) || {};
  state.global_lane_quarantine = state.global_lane_quarantine || {};
  state.quarantine_queue = Array.isArray(state.quarantine_queue) ? state.quarantine_queue : [];

  const now = new Date().toISOString();
  const existing = state.global_lane_quarantine[lane] || {};
  const alreadyActive = existing.active === true;

  state.global_lane_quarantine[lane] = {
    ...existing,
    active: true,
    reason,
    required_action: requiredAction,
    source: "operator_manual",
    at: now,
    by: actor,
  };

  state.quarantine_queue.push({
    at: now,
    action: "QUARANTINE",
    lane,
    reason,
    required_action: requiredAction,
    actor,
    already_active: alreadyActive,
  });
  if (state.quarantine_queue.length > 500) {
    state.quarantine_queue = state.quarantine_queue.slice(-500);
  }

  state.updated_at = now;
  writeJsonSafe(STATE_PATH, state);

  const report = {
    ok: true,
    lane,
    reason,
    required_action: requiredAction,
    actor,
    already_active: alreadyActive,
    state_path: STATE_PATH,
    generated_at: now,
  };
  const reportPaths = writeReport(report);

  await logIntegrityEvent({
    event_type: "QUARANTINE",
    lane,
    status: "ACTIVE",
    reason,
    actor,
    payload: report,
  }).catch(() => {});

  console.log(JSON.stringify({ ...report, report: reportPaths.latest }, null, 2));
}

main()
  .catch((err) => {
    console.error("[integrity-quarantine] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

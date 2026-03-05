#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "agent-state", "shared-context", "management-integrity-state.json");

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const state = readJsonSafe(STATE_PATH) || {};
  const global = state.global_lane_quarantine || {};
  const queue = Array.isArray(state.quarantine_queue) ? state.quarantine_queue : [];

  const active = Object.entries(global)
    .filter(([, v]) => v && v.active)
    .map(([lane, v]) => ({
      lane,
      reason: v.reason || null,
      required_action: v.required_action || null,
      source: v.source || null,
      at: v.at || null,
      by: v.by || null,
    }))
    .sort((a, b) => String(a.lane).localeCompare(String(b.lane)));

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    state_path: STATE_PATH,
    active_count: active.length,
    active,
    recent_events: queue.slice(-30),
  };

  console.log(JSON.stringify(report, null, 2));
}

main();

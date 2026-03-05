#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const { logIntegrityEvent } = require("../control/integrity-events");

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
  const latest = path.join(REPORTS_DIR, "integrity-unquarantine-latest.json");
  const stamped = path.join(REPORTS_DIR, `integrity-unquarantine-${Date.now()}.json`);
  fs.writeFileSync(latest, JSON.stringify(report, null, 2));
  fs.writeFileSync(stamped, JSON.stringify(report, null, 2));
  return { latest, stamped };
}

async function awaitFreshEvidence(lane, freshnessHours) {
  try {
    const { rows } = await pg.query(
      `
      SELECT event_at, payload_json
      FROM integrity_events
      WHERE lane = $1
        AND event_type = 'RUN_INTEGRITY'
        AND status = 'COMPLETED'
        AND COALESCE((payload_json->'evidence'->>'ok')::boolean, false) = true
        AND event_at >= NOW() - ($2::text || ' hours')::interval
      ORDER BY event_at DESC
      LIMIT 1
      `,
      [lane, String(freshnessHours)]
    );
    const latest = rows[0];
    if (!latest) {
      return { ok: false, reason: "NO_FRESH_EVIDENCE", lane, freshness_hours: freshnessHours };
    }
    return {
      ok: true,
      lane,
      freshness_hours: freshnessHours,
      latest_event_at: latest.event_at,
      latest_evidence_types: latest.payload_json?.evidence?.types || [],
    };
  } catch (err) {
    return { ok: false, reason: `EVIDENCE_QUERY_FAILED:${err.message}`, lane, freshness_hours: freshnessHours };
  }
}

async function main() {
  const freshnessHours = Math.max(
    1,
    Number(arg("--fresh-hours", process.env.MGMT_UNQUARANTINE_EVIDENCE_MAX_AGE_HOURS || "12")) || 12
  );
  const lane = String(arg("--lane", "")).trim().toLowerCase();
  const reason = String(arg("--reason", "")).trim();
  const actor = String(arg("--by", process.env.USER || "system")).trim();

  if (!lane) {
    console.error("Usage: integrity:unquarantine --lane <name> --reason <text> [--by <actor>]");
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

  const evidence = await awaitFreshEvidence(lane, freshnessHours);
  if (!evidence.ok) {
    const report = {
      ok: false,
      changed: false,
      lane,
      reason,
      actor,
      release_guard: {
        passed: false,
        required_fresh_hours: freshnessHours,
        details: evidence,
      },
      generated_at: new Date().toISOString(),
    };
    const reportPaths = writeReport(report);
    await logIntegrityEvent({
      event_type: "UNQUARANTINE_DENIED",
      lane,
      status: "BLOCKED",
      reason: evidence.reason || "NO_FRESH_EVIDENCE",
      actor,
      payload: report,
    }).catch(() => {});
    console.error(JSON.stringify({ ...report, report: reportPaths.latest }, null, 2));
    process.exit(2);
  }

  const state = readJsonSafe(STATE_PATH);
  if (!state || typeof state !== "object") {
    console.error(`Integrity state not found: ${STATE_PATH}`);
    process.exit(1);
  }

  state.global_lane_quarantine = state.global_lane_quarantine || {};
  state.lane_entries = state.lane_entries || {};
  state.entries = state.entries || {};
  state.quarantine_queue = Array.isArray(state.quarantine_queue) ? state.quarantine_queue : [];

  const now = new Date().toISOString();
  let globalReleased = false;
  let laneEntriesReleased = 0;
  let entriesReleased = 0;

  const globalLane = state.global_lane_quarantine[lane];
  if (globalLane && globalLane.active) {
    state.global_lane_quarantine[lane] = {
      ...globalLane,
      active: false,
      released_at: now,
      release_reason: reason,
      released_by: actor,
    };
    globalReleased = true;
  }

  for (const [k, v] of Object.entries(state.lane_entries)) {
    if (!k.includes(`:${lane}:`)) continue;
    if (v && v.quarantined && v.quarantined.active) {
      state.lane_entries[k] = {
        ...v,
        quarantined: {
          ...v.quarantined,
          active: false,
          released_at: now,
          release_reason: reason,
          released_by: actor,
        },
      };
      laneEntriesReleased += 1;
    }
  }

  for (const [k, v] of Object.entries(state.entries)) {
    if (!k.includes(`:${lane}:`)) continue;
    if (v && v.quarantined && v.quarantined.active) {
      state.entries[k] = {
        ...v,
        quarantined: {
          ...v.quarantined,
          active: false,
          released_at: now,
          release_reason: reason,
          released_by: actor,
        },
      };
      entriesReleased += 1;
    }
  }

  const changed = globalReleased || laneEntriesReleased > 0 || entriesReleased > 0;
  const auditEvent = {
    at: now,
    lane,
    action: "UNQUARANTINE",
    reason,
    actor,
    global_released: globalReleased,
    lane_entries_released: laneEntriesReleased,
    entries_released: entriesReleased,
  };
  state.quarantine_queue.push(auditEvent);
  if (state.quarantine_queue.length > 500) {
    state.quarantine_queue = state.quarantine_queue.slice(-500);
  }
  state.updated_at = now;
  writeJsonSafe(STATE_PATH, state);

  const report = {
    ok: changed,
    changed,
    lane,
    reason,
    actor,
    release_guard: {
      passed: true,
      required_fresh_hours: freshnessHours,
      evidence,
    },
    global_released: globalReleased,
    lane_entries_released: laneEntriesReleased,
    entries_released: entriesReleased,
    state_path: STATE_PATH,
    generated_at: now,
  };
  const reportPaths = writeReport(report);

  await logIntegrityEvent({
    event_type: "UNQUARANTINE",
    lane,
    status: changed ? "COMPLETED" : "NOOP",
    reason,
    actor,
    payload: report,
  }).catch(() => {});

  console.log(JSON.stringify({ ...report, report: reportPaths.latest }, null, 2));
  process.exit(0);
}

main()
  .catch((err) => {
    console.error("[integrity-unquarantine] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

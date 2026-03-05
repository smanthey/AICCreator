"use strict";

const pg = require("../infra/postgres");

let _tableEnsured = false;

async function ensureTable() {
  if (_tableEnsured) return;
  await pg.query(`
    CREATE TABLE IF NOT EXISTS integrity_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type TEXT NOT NULL,
      lane TEXT,
      repo TEXT,
      runner_type TEXT,
      agent_id TEXT,
      status TEXT,
      reason TEXT,
      actor TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_integrity_events_event_at
      ON integrity_events(event_at DESC)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_integrity_events_lane_event_at
      ON integrity_events(lane, event_at DESC)
  `);
  _tableEnsured = true;
}

async function logIntegrityEvent(event) {
  await ensureTable();
  const payload = event && typeof event === "object" ? event : {};
  await pg.query(
    `INSERT INTO integrity_events
      (event_type, lane, repo, runner_type, agent_id, status, reason, actor, payload_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      String(payload.event_type || "UNKNOWN"),
      payload.lane || null,
      payload.repo || null,
      payload.runner_type || null,
      payload.agent_id || null,
      payload.status || null,
      payload.reason || null,
      payload.actor || null,
      JSON.stringify(payload || {}),
    ]
  );
}

module.exports = {
  ensureTable,
  logIntegrityEvent,
};


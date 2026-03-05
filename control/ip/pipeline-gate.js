"use strict";

const pg = require("../../infra/postgres");

const REQUIRED_KEYS = [
  "ingestion_complete",
  "parsing_complete",
  "tagging_complete",
  "categorization_complete",
  "paralegal_enabled",
];

async function ensureStateRows() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS ip_pipeline_state (
      id BIGSERIAL PRIMARY KEY,
      state_key TEXT NOT NULL UNIQUE,
      state_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `).catch(() => {});

  for (const key of REQUIRED_KEYS) {
    await pg.query(
      `INSERT INTO ip_pipeline_state (state_key, state_value, metadata_json)
       VALUES ($1, 'false', '{}'::jsonb)
       ON CONFLICT (state_key) DO NOTHING`,
      [key]
    ).catch(() => {});
  }
}

async function getStateMap() {
  await ensureStateRows();
  const { rows } = await pg.query(`SELECT state_key, state_value FROM ip_pipeline_state`);
  const map = new Map();
  for (const row of rows) map.set(row.state_key, String(row.state_value).toLowerCase());
  return map;
}

async function setState(key, value, metadata = {}) {
  await ensureStateRows();
  await pg.query(
    `INSERT INTO ip_pipeline_state (state_key, state_value, metadata_json, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (state_key)
     DO UPDATE SET
       state_value = EXCLUDED.state_value,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = NOW()`,
    [key, String(value), JSON.stringify(metadata || {})]
  );
}

async function assertParalegalReady({ force = false } = {}) {
  const map = await getStateMap();

  const checks = {
    ingestion_complete: map.get("ingestion_complete") === "true",
    parsing_complete: map.get("parsing_complete") === "true",
    tagging_complete: map.get("tagging_complete") === "true",
    categorization_complete: map.get("categorization_complete") === "true",
    paralegal_enabled: map.get("paralegal_enabled") === "true",
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length && !force) {
    const err = new Error(`PARALEGAL_GATED: blocked until pipeline complete (${failed.join(", ")})`);
    err.code = "PARALEGAL_GATED";
    throw err;
  }

  return { checks, failed };
}

module.exports = {
  getStateMap,
  setState,
  assertParalegalReady,
};

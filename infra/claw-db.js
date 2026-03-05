// infra/claw-db.js
// Separate Postgres pool for the `claw` file-indexer database.
// This is the data plane — the `claw` repo writes files here,
// and Architect reads them when planning file operations.
//
// Env vars (separate from the main DB):
//   CLAW_DB_HOST     — defaults to POSTGRES_HOST
//   CLAW_DB_PORT     — defaults to POSTGRES_PORT
//   CLAW_DB_USER     — defaults to POSTGRES_USER
//   CLAW_DB_PASSWORD — defaults to POSTGRES_PASSWORD
//   CLAW_DB_NAME     — defaults to "claw"

require("dotenv").config();
const { Pool } = require("pg");

// Fall back to architect DB vars if claw-specific ones not set
const pool = new Pool({
  host:     process.env.CLAW_DB_HOST     || process.env.POSTGRES_HOST,
  port:     parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
  user:     process.env.CLAW_DB_USER     || process.env.POSTGRES_USER,
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.CLAW_DB_NAME     || "claw",
  // Don't crash the whole process if claw DB is unavailable
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  // Non-fatal — architect still runs without claw DB
  console.warn("[claw-db] Pool error (non-fatal):", err.message);
});

/**
 * Test connectivity. Returns { ok, error }.
 * Used at startup and for the /dbstatus Telegram command.
 */
async function ping() {
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { pool, ping };

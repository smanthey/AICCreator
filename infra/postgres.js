const { Pool } = require("pg");
require("dotenv").config();

// Support both POSTGRES_* (preferred) and CLAW_DB_* (legacy) env var naming.
// Fail fast if neither host nor password is resolvable — avoids silent auth failures.
const host     = process.env.POSTGRES_HOST     || process.env.CLAW_DB_HOST;
const password = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;

if (!host) {
  console.error("❌ POSTGRES_HOST / CLAW_DB_HOST is not set. Cannot connect to database.");
  process.exit(1);
}
if (!password) {
  console.error("❌ POSTGRES_PASSWORD / CLAW_DB_PASSWORD is not set. Cannot connect to database.");
  process.exit(1);
}

const pool = new Pool({
  host,
  port:     parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
  user:     process.env.POSTGRES_USER     || process.env.CLAW_DB_USER     || "claw",
  password,
  database: process.env.POSTGRES_DB       || process.env.CLAW_DB_NAME     || "claw_architect",
  // max=10 prevents pool exhaustion under concurrent dispatch+rebalance+retry+notify cycles.
  // With max=5, ~6 concurrent pg operations (dispatch + rebalance + retry + notify + heartbeat
  // + audit) saturated the pool and caused the 10-minute timeout cascade seen in gateway-error.log.
  max: parseInt(process.env.PG_POOL_MAX || "10", 10),
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("connect", () => {
  console.log("✅ Postgres connected");
});

pool.on("error", (err) => {
  console.error("❌ Postgres pool error:", err.message);
});

async function shutdown(signal) {
  try {
    await pool.end();
  } catch (_) {
    // noop
  } finally {
    // Important: exit after closing pool so process never stays alive with a dead pool.
    process.exit(signal === "SIGINT" ? 130 : 0);
  }
}

process.on("SIGTERM", () => { shutdown("SIGTERM"); });
process.on("SIGINT", () => { shutdown("SIGINT"); });

module.exports = pool;

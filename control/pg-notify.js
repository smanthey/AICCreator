// control/pg-notify.js
// Shared pg_notify LISTEN for task_created. Wakes dispatcher immediately when plans are inserted.
// Used by: cli/run-dispatcher.js, gateway/telegram.js

"use strict";

const { Client } = require("pg");

const pgHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const pgPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const pgUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const pgPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const pgDb = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

const RECONNECT_BASE_MS  = 5_000;
const RECONNECT_MAX_MS   = 60_000;
const RECONNECT_FACTOR   = 2;

/**
 * Set up LISTEN task_created. On notification, calls onNotify().
 * @param {() => Promise<void>} onNotify - Callback to run on each notification (e.g. dispatchPendingTasks)
 * @param {number} [_attempt=0] - Internal: current reconnect attempt (for backoff)
 * @returns {Promise<Client|null>} The LISTEN client, or null if setup failed
 */
async function setupPgNotifyListener(onNotify, _attempt = 0) {
  if (!pgHost || !pgPass) {
    console.warn("[pg_notify] Missing Postgres env — skipping LISTEN");
    return null;
  }

  const listenClient = new Client({
    host: pgHost,
    port: pgPort,
    user: pgUser,
    password: pgPass,
    database: pgDb,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await listenClient.connect();
    await listenClient.query("LISTEN task_created");

    listenClient.on("notification", () => {
      onNotify().catch((err) => console.warn("[pg_notify] onNotify failed:", err.message));
    });

    listenClient.on("error", (err) => {
      console.warn("[pg_notify] LISTEN client error:", err.message);
      // End the broken client before spawning a new one to avoid fd/connection leaks
      listenClient.end().catch(() => {});
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, _attempt), RECONNECT_MAX_MS);
      console.warn(`[pg_notify] Reconnecting in ${delay / 1000}s (attempt ${_attempt + 1})…`);
      setTimeout(() => setupPgNotifyListener(onNotify, _attempt + 1).catch(console.error), delay);
    });

    // Reset backoff on successful connect
    if (_attempt > 0) {
      console.log(`[pg_notify] ✓ Reconnected after ${_attempt} attempt(s)`);
    }
    console.log("[pg_notify] ✓ LISTEN task_created — instant dispatch enabled");
    return listenClient;
  } catch (err) {
    // Clean up before retrying
    listenClient.end().catch(() => {});
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, _attempt), RECONNECT_MAX_MS);
    console.warn(`[pg_notify] Failed to set up LISTEN (attempt ${_attempt + 1}), retrying in ${delay / 1000}s: ${err.message}`);
    setTimeout(() => setupPgNotifyListener(onNotify, _attempt + 1).catch(console.error), delay);
    return null;
  }
}

module.exports = { setupPgNotifyListener };

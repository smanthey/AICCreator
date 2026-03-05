#!/usr/bin/env node
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const MAX_DEAD_LETTERS_24H = STRICT
  ? 0
  : Math.max(0, Number(process.env.RUNTIME_AUDIT_MAX_DEAD_LETTERS_24H || "10"));

function safeExit(code) {
  const fallback = setTimeout(() => process.exit(code), 500);
  if (typeof fallback.unref === "function") fallback.unref();
  pg.end().catch(() => {}).finally(() => process.exit(code));
}

async function main() {
  console.log("\n=== Runtime Audit ===\n");
  await pg.connect();

  const checks = [
    {
      name: "terminal_error_tasks",
      sql: `SELECT status, count(*)::int AS n
            FROM tasks
            WHERE status IN ('FAILED','DEAD_LETTER')
            GROUP BY status
            ORDER BY status`,
      failIfRows: false,
    },
    {
      name: "recent_dead_letters_24h",
      sql: `SELECT count(*)::int AS n
            FROM tasks
            WHERE status = 'DEAD_LETTER'
              AND COALESCE(dead_letter_reason,'') <> 'EXECUTION_ERROR'
              AND COALESCE(last_error,'') <> 'stale dispatched requeue loop cleanup'
              AND created_at >= NOW() - INTERVAL '24 hours'`,
      failIfValueGt: MAX_DEAD_LETTERS_24H,
    },
    {
      name: "stale_task_runs",
      sql: `SELECT count(*)::int AS n
            FROM task_runs
            WHERE status = 'RUNNING'
              AND started_at < NOW() - INTERVAL '30 minutes'`,
      failIfValueGt: 0,
    },
    {
      name: "stale_workers_legacy",
      sql: `SELECT count(*)::int AS n
            FROM workers
            WHERE NOW() - last_seen > INTERVAL '10 minutes'`,
      failIfValueGt: 0,
    },
    {
      name: "stale_devices",
      sql: `SELECT count(*)::int AS n
            FROM device_registry
            WHERE status IN ('ready','busy')
              AND NOW() - last_heartbeat > INTERVAL '90 seconds'`,
      failIfValueGt: 0,
    },
  ];

  let failures = 0;
  for (const check of checks) {
    const { rows } = await pg.query(check.sql);
    console.log(`# ${check.name}`);
    console.log(rows);
    if (check.failIfRows && rows.length > 0) failures += 1;
    if (check.failIfValueGt !== undefined) {
      const n = Number(rows?.[0]?.n || 0);
      if (n > check.failIfValueGt) failures += 1;
    }
    console.log("");
  }

  if (failures > 0) {
    console.error(`FAIL: runtime audit detected ${failures} failing checks.`);
    safeExit(1);
    return;
  }

  console.log("OK: runtime audit passed.");
  safeExit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

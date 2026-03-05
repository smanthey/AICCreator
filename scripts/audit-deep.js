#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

function runStep(name, cmd, args) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    cwd: process.cwd(),
  });
  const ms = Date.now() - started;
  const ok = r.status === 0;
  return {
    name,
    ok,
    ms,
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

async function dbChecks() {
  const checks = [];
  const push = (name, ok, details) => checks.push({ name, ok, details });

  const tables = (await pg.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname='public'`
  )).rows.map((r) => r.tablename);

  const cols = (await pg.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema='public'`
  )).rows;

  const hasTable = (t) => tables.includes(t);
  const hasCol = (t, c) => cols.some((r) => r.table_name === t && r.column_name === c);

  const invalidConstraints = await pg.query(
    `SELECT count(*)::int AS n
     FROM pg_constraint
     WHERE NOT convalidated`
  );
  push("db.invalid_constraints", invalidConstraints.rows[0].n === 0, invalidConstraints.rows[0]);

  const invalidIndexes = await pg.query(
    `SELECT count(*)::int AS n
     FROM pg_index
     WHERE NOT indisvalid`
  );
  push("db.invalid_indexes", invalidIndexes.rows[0].n === 0, invalidIndexes.rows[0]);

  const staleRunning = await pg.query(
    `SELECT count(*)::int AS n
     FROM tasks
     WHERE status='RUNNING'
       AND started_at < NOW() - INTERVAL '30 minutes'`
  );
  push("db.stale_running_tasks", staleRunning.rows[0].n === 0, staleRunning.rows[0]);

  if (hasTable("task_runs")) {
    const staleTaskRuns = await pg.query(
      `SELECT count(*)::int AS n
       FROM task_runs
       WHERE status='RUNNING'
         AND started_at < NOW() - INTERVAL '30 minutes'`
    );
    push("db.stale_task_runs", staleTaskRuns.rows[0].n === 0, staleTaskRuns.rows[0]);
  }

  if (hasTable("device_registry")) {
    const staleDevices = await pg.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status='offline')::int AS offline,
         count(*) FILTER (WHERE status IN ('ready','busy') AND NOW() - last_heartbeat > INTERVAL '24 hours')::int AS stale_active_24h
       FROM device_registry`
    );
    // Offline history rows are expected from prior restarts/devices.
    // Only active rows older than 24h represent real runtime drift.
    push("db.device_registry_stale_24h", staleDevices.rows[0].stale_active_24h === 0, staleDevices.rows[0]);
  }

  if (hasTable("workflow_locks")) {
    const staleLocks = await pg.query(
      `SELECT count(*)::int AS n
       FROM workflow_locks
       WHERE expires_at < NOW()`
    );
    push("db.stale_workflow_locks", staleLocks.rows[0].n === 0, staleLocks.rows[0]);
  }

  if (hasTable("ip_deadlines")) {
    const overdueIp = await pg.query(
      `SELECT count(*)::int AS n
       FROM ip_deadlines
       WHERE status='open' AND due_date < CURRENT_DATE`
    );
    push("db.ip_overdue_open_deadlines", true, overdueIp.rows[0]);
  }

  if (hasTable("credit_deadlines")) {
    const dcol = hasCol("credit_deadlines", "due_at") ? "due_at" : "due_date";
    const overdueCredit = await pg.query(
      `SELECT count(*)::int AS n
       FROM credit_deadlines
       WHERE status='open' AND ${dcol} < NOW()`
    );
    push("db.credit_overdue_open_deadlines", true, overdueCredit.rows[0]);
  }

  return checks;
}

async function main() {
  const cmdChecks = [
    runStep("migrations_status", "npm", ["run", "migrate", "--", "--status"]),
    runStep("schema_audit", "npm", ["run", "schema:audit"]),
    runStep("task_contract_audit", "npm", ["run", "audit:tasks"]),
    runStep("agent_drift_audit", "npm", ["run", "audit:drift"]),
    runStep("runtime_audit", "npm", ["run", "audit:runtime"]),
    runStep("topology", "npm", ["run", "verify:topology"]),
    runStep("security_sweep", "npm", ["run", "security:sweep"]),
  ];

  const db = await dbChecks();
  await pg.end();

  const failedCmd = cmdChecks.filter((c) => !c.ok);
  const failedDb = db.filter((d) => !d.ok);

  console.log("\n=== Deep Audit ===\n");
  for (const c of cmdChecks) {
    console.log(`- ${c.ok ? "PASS" : "FAIL"} ${c.name} (${c.ms}ms)`);
    if (!c.ok && c.stderr) console.log(`  stderr: ${c.stderr.split("\n").slice(-2).join(" | ")}`);
  }

  for (const d of db) {
    console.log(`- ${d.ok ? "PASS" : "FAIL"} ${d.name} ${JSON.stringify(d.details)}`);
  }

  if (failedCmd.length || failedDb.length) {
    console.log(`\nFAILED: ${failedCmd.length + failedDb.length} deep-audit check(s) failed.`);
    process.exit(1);
  }

  console.log("\nPASS: all deep-audit checks passed.");
}

main().catch(async (err) => {
  console.error(`FAILED: ${err.message}`);
  try { await pg.end(); } catch {}
  process.exit(1);
});

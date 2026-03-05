#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const Redis = require("ioredis");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const ARGS = process.argv.slice(2);
const hasFlag = (flag) => ARGS.includes(flag);
const jsonOnly = hasFlag("--json");
const noFail = hasFlag("--no-fail");

function ensureReportsDir() {
  const dir = path.join(ROOT, "scripts/reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dbConfig() {
  return {
    host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST,
    port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
    database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
    user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
    password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  };
}

function redisConfig() {
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const isLocalHost = host === "127.0.0.1" || host === "localhost";
  const rawPort = process.env.REDIS_PORT;
  const effectivePort = (!isLocalHost && (!rawPort || rawPort === "6379")) ? "16379" : (rawPort || "6379");
  return {
    host,
    port: parseInt(effectivePort, 10),
  };
}

async function main() {
  const checks = [];
  const failures = [];

  const requiredEnv = [
    "POSTGRES_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "REDIS_HOST",
  ];

  const missing = requiredEnv.filter((k) => !process.env[k] && !process.env[`CLAW_DB_${k.replace("POSTGRES_", "")}`]);
  checks.push({ name: "required_env", ok: missing.length === 0, detail: missing.length ? { missing } : {} });
  if (missing.length) failures.push(`missing env: ${missing.join(", ")}`);

  const pool = new Pool(dbConfig());
  try {
    const ping = await pool.query("SELECT 1 AS ok");
    const dbOk = Number(ping.rows?.[0]?.ok || 0) === 1;
    checks.push({ name: "postgres_connectivity", ok: dbOk, detail: {} });
    if (!dbOk) failures.push("postgres connectivity failed");

    const integrity = await pool.query(
      `SELECT
         (SELECT count(*) FROM pg_constraint WHERE NOT convalidated)::int AS invalid_constraints,
         (SELECT count(*) FROM pg_index WHERE NOT indisvalid)::int AS invalid_indexes`
    );
    const invalidConstraints = Number(integrity.rows?.[0]?.invalid_constraints || 0);
    const invalidIndexes = Number(integrity.rows?.[0]?.invalid_indexes || 0);
    const integrityOk = invalidConstraints === 0 && invalidIndexes === 0;
    checks.push({
      name: "db_integrity",
      ok: integrityOk,
      detail: { invalid_constraints: invalidConstraints, invalid_indexes: invalidIndexes },
    });
    if (!integrityOk) failures.push(`db integrity invalid constraints/indexes (${invalidConstraints}/${invalidIndexes})`);

    const pendingMigrations = await pool.query(
      `WITH files AS (
         SELECT count(*)::int AS total FROM schema_migrations
       )
       SELECT files.total AS applied_total
       FROM files`
    );
    checks.push({
      name: "schema_migrations_present",
      ok: Number(pendingMigrations.rows?.[0]?.applied_total || 0) > 0,
      detail: { applied_total: Number(pendingMigrations.rows?.[0]?.applied_total || 0) },
    });
  } catch (err) {
    checks.push({ name: "postgres_connectivity", ok: false, detail: { error: err.message } });
    failures.push(`postgres error: ${err.message}`);
  } finally {
    await pool.end().catch(() => {});
  }

  const redisCfg = redisConfig();
  const redis = new Redis({
    host: redisCfg.host,
    port: redisCfg.port,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    const pong = await redis.ping();
    const redisOk = String(pong).toUpperCase() === "PONG";
    checks.push({ name: "redis_connectivity", ok: redisOk, detail: { host: redisCfg.host, port: redisCfg.port } });
    if (!redisOk) failures.push("redis connectivity failed");
  } catch (err) {
    checks.push({ name: "redis_connectivity", ok: false, detail: { host: redisCfg.host, port: redisCfg.port, error: err.message } });
    failures.push(`redis error: ${err.message}`);
  } finally {
    redis.disconnect();
  }

  const report = {
    generated_at: new Date().toISOString(),
    tool: "security-runtime-audit",
    summary: {
      checks_total: checks.length,
      checks_failed: checks.filter((c) => !c.ok).length,
      status: failures.length ? "fail" : "pass",
    },
    checks,
    failures,
  };

  const reportsDir = ensureReportsDir();
  const outPath = path.join(reportsDir, `${Date.now()}-security-runtime.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (!jsonOnly) {
    console.log("\n=== Security Runtime Audit ===\n");
    for (const c of checks) {
      console.log(`- ${c.ok ? "PASS" : "FAIL"} ${c.name}`);
    }
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`- ${f}`);
    }
    console.log(`\nreport: ${outPath}`);
  }

  if (!noFail && failures.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[security-runtime-audit] fatal: ${err.message}`);
  process.exit(1);
});

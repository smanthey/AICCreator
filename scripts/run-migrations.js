#!/usr/bin/env node
/**
 * run-migrations.js
 * ──────────────────────────────────────────────────────────────────────────
 * Runs all SQL migrations in order. Tracks applied migrations in a
 * schema_migrations table so each one only runs once.
 *
 * Usage:
 *   node scripts/run-migrations.js              # run all pending migrations
 *   node scripts/run-migrations.js --dry-run    # show what would run
 *   node scripts/run-migrations.js --status     # show applied vs pending
 *   node scripts/run-migrations.js --from 011   # run from migration 011 onward
 *   node scripts/run-migrations.js --only 011   # run only migration 011
 */
"use strict";

const { Pool }  = require("pg");
const fs        = require("fs");
const path      = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DRY_RUN   = process.argv.includes("--dry-run");
const STATUS    = process.argv.includes("--status");
const FROM_IDX  = (() => { const i = process.argv.indexOf("--from"); return i >= 0 ? process.argv[i+1] : null; })();
const ONLY      = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? process.argv[i+1] : null; })();

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

if (!dbHost) {
  console.error("❌ Missing DB host. Set POSTGRES_HOST (preferred) or CLAW_DB_HOST.");
  process.exit(1);
}
if (!dbPass) {
  console.error("❌ Missing DB password. Set POSTGRES_PASSWORD (preferred) or CLAW_DB_PASSWORD.");
  process.exit(1);
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
});

const MIGRATIONS_DIR = path.join(__dirname, "../migrations");
const LEGACY_OPTIONAL_MIGRATIONS = new Set([
  "016",
  "018",
  "019",
  "020",
  "021",
  "022",
  "023",
]);

function isMissingLegacyRelationError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("relation \"files\" does not exist") ||
    msg.includes("relation \"duplicate_groups\" does not exist") ||
    msg.includes("relation \"duplicate_group_members\" does not exist")
  );
}

async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         CLAW-ARCHITECT MIGRATION RUNNER                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`  Target DB        : ${dbUser}@${dbHost}:${dbPort}/${dbName}`);

  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TIMESTAMP DEFAULT NOW(),
      filename    TEXT
    )
  `);

  // Get already-applied migrations
  const { rows: applied } = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
  const appliedSet = new Set(applied.map(r => r.version));

  // Read all migration files
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();

  // Parse version from filename prefix (e.g. "011" from "011_brands_and_leads.sql")
  const migrations = files.map(f => ({
    filename: f,
    version:  f.match(/^(\d+)/)?.[1] || f,
    filepath: path.join(MIGRATIONS_DIR, f),
  }));

  // Filter based on flags
  let toRun = migrations.filter(m => {
    if (ONLY)     return m.version === ONLY || m.filename.startsWith(ONLY);
    if (FROM_IDX) return m.version >= FROM_IDX;
    return true;
  });

  const pending = toRun.filter(m => !appliedSet.has(m.version));

  console.log(`  Total migrations : ${migrations.length}`);
  console.log(`  Already applied  : ${appliedSet.size}`);
  console.log(`  Pending          : ${pending.length}\n`);

  if (STATUS || pending.length === 0) {
    console.log("  Migration status:\n");
    for (const m of migrations) {
      const done = appliedSet.has(m.version);
      console.log(`  ${done ? "✓" : "○"} ${m.filename}`);
    }
    if (pending.length === 0) console.log("\n  ✅ All migrations are up to date.\n");
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log("  ⚠️  DRY RUN — would run:\n");
    for (const m of pending) console.log(`  ○ ${m.filename}`);
    await pool.end();
    return;
  }

  console.log("  Running pending migrations:\n");

  let passed = 0, failed = 0;

  for (const m of pending) {
    process.stdout.write(`  ○ ${m.filename.padEnd(50)}`);
    const sql = fs.readFileSync(m.filepath, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [m.version, m.filename]
      );
      await client.query("COMMIT");
      process.stdout.write(" ✓\n");
      passed++;
    } catch (e) {
      await client.query("ROLLBACK");
      if (LEGACY_OPTIONAL_MIGRATIONS.has(m.version) && isMissingLegacyRelationError(e)) {
        await pool.query(
          "INSERT INTO schema_migrations (version, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [m.version, `${m.filename} [legacy-skip:no-source-table]`]
        );
        process.stdout.write(" ~\n");
        console.log("     Skipped legacy migration (source table not present in this DB).");
        passed++;
      } else {
        process.stdout.write(` ✗\n`);
        console.error(`     Error: ${e.message.split("\n")[0]}`);
        failed++;
      }
      // Don't stop — try remaining migrations
    } finally {
      client.release();
    }
  }

  console.log(`\n  ✅ Applied : ${passed}`);
  if (failed) console.log(`  ❌ Failed  : ${failed} (check errors above)`);
  console.log("");
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

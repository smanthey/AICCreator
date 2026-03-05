#!/usr/bin/env node
/**
 * bootstrap-db.js
 * ──────────────────────────────────────────────────────────────────────────
 * Bootstrap script to ensure task routing schema columns exist.
 * This runs once at startup before the dispatcher starts, removing the need
 * for DDL checks inside the dispatch loop.
 *
 * Usage:
 *   node scripts/bootstrap-db.js              # verify/ensure schema
 *   node scripts/bootstrap-db.js --dry-run    # show what would run
 */

"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

const DRY_RUN = process.argv.includes("--dry-run");

async function bootstrap() {
  console.log("[bootstrap] Ensuring task routing schema is up to date...");
  
  if (DRY_RUN) {
    console.log("[bootstrap] DRY RUN — would execute:");
    console.log("  - ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'");
    console.log("  - ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT");
    console.log("  - ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_run_id TEXT");
    process.exit(0);
  }

  try {
    // Use a single ALTER TABLE statement for atomicity
    await pg.query(`
      ALTER TABLE tasks 
      ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
      ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;
    `);
    
    // Create indexes for performance (idempotent)
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_required_tags ON tasks USING GIN (required_tags);
      CREATE INDEX IF NOT EXISTS idx_tasks_idempotency_key ON tasks (idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_workflow_run_id ON tasks (workflow_run_id) WHERE workflow_run_id IS NOT NULL;
    `).catch((err) => {
      // Index creation failures are non-fatal (may already exist)
      console.warn(`[bootstrap] Index creation warning: ${err.message}`);
    });
    
    console.log("[bootstrap] ✅ Schema verified successfully.");
    process.exit(0);
  } catch (err) {
    console.error("[bootstrap] ❌ Schema verification failed:", err.message);
    process.exit(1);
  }
}

bootstrap();

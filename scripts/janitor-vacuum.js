#!/usr/bin/env node
/**
 * scripts/janitor-vacuum.js
 * ──────────────────────────────────────────────────────────────────────────
 * Database maintenance script to prune old telemetry and logs.
 * Prevents I/O slowdown in the dispatcher and model-router.
 *
 * Retention:
 * - audit_log: 30 days
 * - model_usage: 90 days
 *
 * This script is critical for long-term system health. Without it, the
 * dispatcher's COUNT(*) queries on audit_log (used in reapStuckTasks) will
 * eventually become slow, delaying every dispatch cycle.
 *
 * Usage:
 *   node scripts/janitor-vacuum.js              # Run cleanup
 *   node scripts/janitor-vacuum.js --dry-run    # Show what would be deleted
 */
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

// Retention settings (can be overridden via env vars)
const AUDIT_LOG_RETENTION_DAYS = Number(process.env.JANITOR_AUDIT_RETENTION_DAYS || 30);
const MODEL_USAGE_RETENTION_DAYS = Number(process.env.JANITOR_MODEL_USAGE_RETENTION_DAYS || 90);
const DRY_RUN = process.argv.includes("--dry-run");

async function runCleanup() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         CLAW-ARCHITECT DATABASE JANITOR                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  
  if (DRY_RUN) {
    console.log("⚠️  DRY RUN MODE — No changes will be made\n");
  }

  const startTime = Date.now();

  try {
    // 1. Prune audit_log (High volume transitions)
    // This table is queried frequently in dispatcher.js for reaped-count checks
    console.log(`[janitor] Pruning audit_log (older than ${AUDIT_LOG_RETENTION_DAYS} days)...`);
    
    if (DRY_RUN) {
      const { rows: auditPreview } = await pg.query(
        `SELECT COUNT(*)::int AS count, 
                MIN(created_at) AS oldest,
                MAX(created_at) AS newest
         FROM audit_log 
         WHERE created_at < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'`
      );
      const preview = auditPreview[0];
      console.log(`[janitor] Would remove ${preview.count} entries (oldest: ${preview.oldest}, newest: ${preview.newest})`);
    } else {
      const auditRes = await pg.query(
        `DELETE FROM audit_log 
         WHERE created_at < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'`
      );
      console.log(`[janitor] ✓ Removed ${auditRes.rowCount} stale audit entries.`);
    }

    // 2. Prune model_usage (Token and cost tracking)
    // This table grows with every LLM call and is used for budget tracking
    console.log(`[janitor] Pruning model_usage (older than ${MODEL_USAGE_RETENTION_DAYS} days)...`);
    
    if (DRY_RUN) {
      const { rows: modelPreview } = await pg.query(
        `SELECT COUNT(*)::int AS count,
                MIN(created_at) AS oldest,
                MAX(created_at) AS newest,
                COALESCE(SUM(cost_usd), 0) AS total_cost
         FROM model_usage 
         WHERE created_at < NOW() - INTERVAL '${MODEL_USAGE_RETENTION_DAYS} days'`
      );
      const preview = modelPreview[0];
      console.log(`[janitor] Would remove ${preview.count} entries (oldest: ${preview.oldest}, newest: ${preview.newest}, cost: $${Number(preview.total_cost).toFixed(2)})`);
    } else {
      const modelRes = await pg.query(
        `DELETE FROM model_usage 
         WHERE created_at < NOW() - INTERVAL '${MODEL_USAGE_RETENTION_DAYS} days'`
      );
      console.log(`[janitor] ✓ Removed ${modelRes.rowCount} stale usage records.`);
    }

    // 3. VACUUM ANALYZE tables to reclaim space and update statistics
    // This is critical for query planner performance on large tables
    if (!DRY_RUN) {
      console.log("[janitor] Optimizing table statistics (VACUUM ANALYZE)...");
      await pg.query("VACUUM ANALYZE audit_log;").catch((err) => {
        console.warn(`[janitor] VACUUM audit_log warning: ${err.message}`);
      });
      await pg.query("VACUUM ANALYZE model_usage;").catch((err) => {
        console.warn(`[janitor] VACUUM model_usage warning: ${err.message}`);
      });
      console.log("[janitor] ✓ Table optimization complete.");
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Database maintenance completed in ${duration}s.\n`);

  } catch (err) {
    console.error("\n❌ Janitor failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // Close the pool connection to allow script to exit cleanly
    await pg.end().catch(() => {});
  }
}

// Ensure this only runs if called directly
if (require.main === module) {
  runCleanup().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = { runCleanup };

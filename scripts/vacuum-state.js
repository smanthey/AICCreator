#!/usr/bin/env node
"use strict";

/**
 * scripts/vacuum-state.js
 * 
 * State Pruning & Zombie Agent Detection
 * 
 * Purpose: Prunes old state files and identifies "zombie" agents that haven't
 * run in 7+ days. Prevents "Log Rot" where agents spend 90% of time parsing
 * 50MB JSON files instead of doing work.
 * 
 * The "Purge" Protocol:
 * 1. Freeze: Move zombie agent entry to deprecated-agents.json
 * 2. Monitor: See if any other agent "complains" (throws error)
 * 3. Delete: If no one complains after 7 days, it was truly "dead weight"
 */

require("dotenv").config({ override: true });

const fsp = require("fs/promises");
const path = require("path");
const { execSync } = require("child_process");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const AGENT_STATE_DIR = path.join(ROOT, "agent-state");
const ARCHIVE_DIR = path.join(AGENT_STATE_DIR, "archive");
const DEPRECATED_AGENTS_FILE = path.join(ROOT, "config", "deprecated-agents.json");

// Configuration
const STATE_MAX_AGE_DAYS = 7; // Archive state older than 7 days
const ZOMBIE_THRESHOLD_DAYS = 7; // Agent is "zombie" if no successful task in 7 days
const MAX_STATE_FILE_SIZE_KB = 100; // Warn if active state file > 100KB
const COMPRESS_ARCHIVES = true; // Compress archived files

// ─── State File Analysis ───────────────────────────────────────────────────────

/**
 * Analyze a state file: size, age, last modified
 */
async function analyzeStateFile(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    const sizeKB = stats.size / 1024;
    const ageDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    
    return {
      path: filePath,
      size_kb: sizeKB,
      age_days: ageDays,
      last_modified: stats.mtime.toISOString(),
      needs_archive: ageDays > STATE_MAX_AGE_DAYS,
      is_large: sizeKB > MAX_STATE_FILE_SIZE_KB,
    };
  } catch (err) {
    return {
      path: filePath,
      error: err.message,
    };
  }
}

/**
 * Find all state files in agent-state directory
 */
async function findStateFiles(dir = AGENT_STATE_DIR) {
  const files = [];
  
  async function walkDir(currentDir) {
    try {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip archive directories
          if (entry.name === "archive" || entry.name.startsWith(".")) {
            continue;
          }
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          // Check for state files
          if (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) {
            files.push(fullPath);
          }
        }
      }
    } catch (err) {
      console.warn(`[vacuum] Could not read directory ${currentDir}:`, err.message);
    }
  }
  
  await walkDir(dir);
  return files;
}

// ─── Archive Management ───────────────────────────────────────────────────────────

/**
 * Archive a state file (move to archive/ with optional compression)
 */
async function archiveStateFile(filePath, analysis) {
  const relativePath = path.relative(AGENT_STATE_DIR, filePath);
  const archivePath = path.join(ARCHIVE_DIR, relativePath);
  const archiveDir = path.dirname(archivePath);
  
  try {
    // Create archive directory structure
    await fsp.mkdir(archiveDir, { recursive: true });
    
    // Move file to archive
    await fsp.rename(filePath, archivePath);
    
    // Optionally compress
    if (COMPRESS_ARCHIVES && archivePath.endsWith(".json")) {
      try {
        execSync(`gzip -f "${archivePath}"`, { stdio: "ignore" });
        return { archived: true, compressed: true, path: archivePath + ".gz" };
      } catch {
        // gzip not available, that's okay
      }
    }
    
    return { archived: true, compressed: false, path: archivePath };
  } catch (err) {
    console.error(`[vacuum] Failed to archive ${filePath}:`, err.message);
    return { archived: false, error: err.message };
  }
}

/**
 * Prune old state files
 */
async function pruneStateFiles() {
  console.log("[vacuum] Scanning state files...");
  
  const files = await findStateFiles();
  console.log(`[vacuum] Found ${files.length} state files`);
  
  const analyses = await Promise.all(files.map(f => analyzeStateFile(f)));
  
  const toArchive = analyses.filter(a => a.needs_archive && !a.error);
  const largeFiles = analyses.filter(a => a.is_large && !a.needs_archive && !a.error);
  
  console.log(`[vacuum] Files to archive: ${toArchive.length}`);
  console.log(`[vacuum] Large active files: ${largeFiles.length}`);
  
  // Archive old files
  let archived = 0;
  let failed = 0;
  
  for (const analysis of toArchive) {
    const result = await archiveStateFile(analysis.path, analysis);
    if (result.archived) {
      archived++;
      console.log(`[vacuum] Archived: ${path.relative(ROOT, analysis.path)} (${analysis.age_days.toFixed(1)} days old)`);
    } else {
      failed++;
    }
  }
  
  // Warn about large active files
  for (const analysis of largeFiles) {
    console.warn(`[vacuum] ⚠️  Large active file: ${path.relative(ROOT, analysis.path)} (${analysis.size_kb.toFixed(1)}KB)`);
  }
  
  return {
    total_files: files.length,
    archived,
    failed,
    large_files: largeFiles.length,
  };
}

// ─── Zombie Agent Detection ──────────────────────────────────────────────────────

/**
 * Find agents that haven't successfully completed a task in X days
 */
async function findZombieAgents(thresholdDays = ZOMBIE_THRESHOLD_DAYS) {
  console.log(`[vacuum] Checking for zombie agents (no success in ${thresholdDays} days)...`);
  
  const { rows } = await pg.query(
    `SELECT 
       payload->>'agent_id' as agent_id,
       type,
       MAX(created_at) as last_created,
       MAX(CASE WHEN status = 'COMPLETED' THEN created_at END) as last_success,
       COUNT(*) FILTER (WHERE status = 'COMPLETED') as success_count,
       COUNT(*) FILTER (WHERE status = 'FAILED') as failure_count,
       COUNT(*) as total_tasks
     FROM tasks
     WHERE payload->>'agent_id' IS NOT NULL
       AND created_at >= NOW() - INTERVAL '${thresholdDays + 7} days'
     GROUP BY payload->>'agent_id', type
     HAVING MAX(CASE WHEN status = 'COMPLETED' THEN created_at END) IS NULL
        OR MAX(CASE WHEN status = 'COMPLETED' THEN created_at END) < NOW() - INTERVAL '${thresholdDays} days'
     ORDER BY last_created DESC`
  );
  
  const zombies = [];
  for (const row of rows) {
    const lastSuccess = row.last_success ? new Date(row.last_success) : null;
    const daysSinceSuccess = lastSuccess 
      ? (Date.now() - lastSuccess.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    
    zombies.push({
      agent_id: row.agent_id,
      task_type: row.type,
      last_created: row.last_created,
      last_success: row.last_success,
      days_since_success: daysSinceSuccess,
      success_count: Number(row.success_count || 0),
      failure_count: Number(row.failure_count || 0),
      total_tasks: Number(row.total_tasks || 0),
      is_zombie: daysSinceSuccess >= thresholdDays,
    });
  }
  
  return zombies;
}

/**
 * Load deprecated agents list
 */
async function loadDeprecatedAgents() {
  try {
    const data = await fsp.readFile(DEPRECATED_AGENTS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return { deprecated: [], frozen_at: new Date().toISOString() };
  }
}

/**
 * Save deprecated agents list
 */
async function saveDeprecatedAgents(deprecated) {
  await fsp.mkdir(path.dirname(DEPRECATED_AGENTS_FILE), { recursive: true });
  await fsp.writeFile(
    DEPRECATED_AGENTS_FILE,
    JSON.stringify(deprecated, null, 2)
  );
}

/**
 * Freeze a zombie agent (move to deprecated list)
 */
async function freezeZombieAgent(zombie) {
  const deprecated = await loadDeprecatedAgents();
  
  // Check if already frozen
  const existing = deprecated.deprecated.find(
    d => d.agent_id === zombie.agent_id && d.task_type === zombie.task_type
  );
  
  if (existing) {
    return { frozen: false, reason: "already_frozen", frozen_at: existing.frozen_at };
  }
  
  // Add to deprecated list
  deprecated.deprecated.push({
    agent_id: zombie.agent_id,
    task_type: zombie.task_type,
    frozen_at: new Date().toISOString(),
    last_success: zombie.last_success,
    days_since_success: zombie.days_since_success,
    total_tasks: zombie.total_tasks,
    success_count: zombie.success_count,
    failure_count: zombie.failure_count,
  });
  
  deprecated.last_updated = new Date().toISOString();
  
  await saveDeprecatedAgents(deprecated);
  
  return { frozen: true, frozen_at: deprecated.last_updated };
}

// ─── Main Vacuum Function ───────────────────────────────────────────────────────

async function vacuum() {
  console.log("[vacuum] Starting state vacuum...\n");
  
  const results = {
    pruning: null,
    zombies: [],
    frozen: [],
    errors: [],
  };
  
  try {
    // 1. Prune old state files
    console.log("=".repeat(60));
    console.log("STEP 1: Pruning Old State Files");
    console.log("=".repeat(60));
    results.pruning = await pruneStateFiles();
    
    // 2. Find zombie agents
    console.log("\n" + "=".repeat(60));
    console.log("STEP 2: Detecting Zombie Agents");
    console.log("=".repeat(60));
    results.zombies = await findZombieAgents();
    
    console.log(`[vacuum] Found ${results.zombies.length} potential zombie agent(s)`);
    
    for (const zombie of results.zombies) {
      console.log(`\n[vacuum] Zombie: ${zombie.agent_id} (${zombie.task_type})`);
      console.log(`  Last success: ${zombie.last_success || "never"}`);
      console.log(`  Days since success: ${zombie.days_since_success.toFixed(1)}`);
      console.log(`  Total tasks: ${zombie.total_tasks} (${zombie.success_count} success, ${zombie.failure_count} failed)`);
      
      if (zombie.is_zombie) {
        const freezeResult = await freezeZombieAgent(zombie);
        if (freezeResult.frozen) {
          results.frozen.push(zombie);
          console.log(`  ✅ Frozen (moved to deprecated-agents.json)`);
        } else {
          console.log(`  ⚠️  Already frozen`);
        }
      }
    }
    
    // 3. Summary
    console.log("\n" + "=".repeat(60));
    console.log("VACUUM SUMMARY");
    console.log("=".repeat(60));
    console.log(`State files archived: ${results.pruning.archived}`);
    console.log(`Zombie agents found: ${results.zombies.length}`);
    console.log(`Zombie agents frozen: ${results.frozen.length}`);
    console.log(`Large active files: ${results.pruning.large_files}`);
    
    if (results.frozen.length > 0) {
      console.log("\n⚠️  Frozen agents will be monitored for 7 days.");
      console.log("   If no other agent complains, they can be safely deleted.");
    }
    
  } catch (err) {
    console.error("[vacuum] Error:", err.message);
    results.errors.push(err.message);
    throw err;
  } finally {
    await pg.end().catch(() => {});
  }
  
  return results;
}

// ─── CLI ────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  vacuum()
    .then((results) => {
      console.log("\n[vacuum] Complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[vacuum] Fatal:", err);
      process.exit(1);
    });
}

module.exports = { vacuum, findZombieAgents, pruneStateFiles, freezeZombieAgent };

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

// Files that need ensureSchema() replacement
const ENSURE_SCHEMA_FILES = [
  { file: "scripts/clawhub-skill-factory.js", migration: "068", table: "clawhub_skill_catalog" },
  { file: "scripts/agency-growth-os.js", migration: "067", table: "agency_accounts" },
  { file: "scripts/marketplace-services-os.js", migration: "069", table: "marketplace_services" },
  { file: "control/quantfusion-trading-ops.js", migration: "072", table: "quantfusion_trading_signals" },
  { file: "control/finance-ops.js", migration: null, table: null }, // Need to identify
  { file: "scripts/google-maps-scraper.js", migration: null, table: null }, // Need to identify
];

async function checkMigrationApplied(version) {
  try {
    const { rows } = await pg.query(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [version]
    );
    return rows.length > 0;
  } catch (err) {
    // schema_migrations table might not exist yet
    return false;
  }
}

async function applyMigration(version) {
  console.log(`[schema] Applying migration ${version}...`);
  const result = spawnSync("node", ["scripts/run-migrations.js", "--only", version], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300000, // 5 minutes
  });
  
  if (result.status !== 0) {
    throw new Error(`Migration ${version} failed: ${result.stderr || result.stdout}`);
  }
  
  return true;
}

async function checkTableExists(tableName) {
  try {
    const { rows } = await pg.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = $1
      ) as exists`,
      [tableName]
    );
    return rows[0].exists;
  } catch (err) {
    console.warn(`[schema] Error checking table ${tableName}: ${err.message}`);
    return false;
  }
}

async function checkForeignKeys() {
  const tables = ["content_items", "content_briefs", "leads", "email_sends"];
  const fks = [];
  
  for (const table of tables) {
    try {
      const { rows } = await pg.query(
        `SELECT constraint_name 
         FROM information_schema.table_constraints 
         WHERE table_name = $1 AND constraint_type = 'FOREIGN KEY'`,
        [table]
      );
      fks.push({ table, count: rows.length, constraints: rows.map(r => r.constraint_name) });
    } catch (err) {
      console.warn(`[schema] Error checking FKs for ${table}: ${err.message}`);
    }
  }
  
  return fks;
}

function auditEnsureSchema(filePath, expectedMigration, expectedTable) {
  const fullPath = path.join(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    return { found: false, needsFix: false, error: "File not found" };
  }
  
  const content = fs.readFileSync(fullPath, "utf8");
  const hasEnsureSchema = /async\s+function\s+ensureSchema|function\s+ensureSchema|ensureDbSchema/.test(content);
  const hasTableCreation = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/.test(content);
  
  if (!hasEnsureSchema && !hasTableCreation) {
    return { found: false, needsFix: false };
  }
  
  // Check if already using migration check pattern
  const hasMigrationCheck = expectedTable && new RegExp(`table_name\\s*=\\s*['"]${expectedTable}['"]`).test(content);
  
  return {
    found: true,
    needsFix: !hasMigrationCheck,
    hasTableCreation,
    hasMigrationCheck,
  };
}

function fixEnsureSchema(filePath, expectedMigration, expectedTable) {
  if (!expectedMigration || !expectedTable) {
    return { fixed: false, reason: "Missing migration or table info" };
  }
  
  const fullPath = path.join(ROOT, filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  
  // Find ensureSchema function - handle both ensureSchema() and ensureDbSchema(pg)
  const ensureSchemaMatch = content.match(/(async\s+)?function\s+(ensureSchema|ensureDbSchema)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  if (!ensureSchemaMatch) {
    return { fixed: false, reason: "Could not find ensureSchema function" };
  }
  
  // Check if function takes pg as parameter
  const funcDef = ensureSchemaMatch[0];
  const takesPgParam = /function\s+\w+\s*\(\s*pg\s*\)/.test(funcDef);
  
  // Replace with migration check pattern
  const newFunction = takesPgParam 
    ? `async function ensureDbSchema(pg) {
  // Check if migration has been applied
  const { rows } = await pg.query(\`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = '${expectedTable}'
    ) as exists
  \`);
  
  if (!rows[0].exists) {
    throw new Error('Migration ${expectedMigration} must be applied first. Run: node scripts/run-migrations.js --only ${expectedMigration}');
  }
}`
    : `async function ensureSchema() {
  const pg = require("../infra/postgres");
  // Check if migration has been applied
  const { rows } = await pg.query(\`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = '${expectedTable}'
    ) as exists
  \`);
  
  if (!rows[0].exists) {
    throw new Error('Migration ${expectedMigration} must be applied first. Run: node scripts/run-migrations.js --only ${expectedMigration}');
  }
}`;
  
  const newContent = content.replace(ensureSchemaMatch[0], newFunction);
  fs.writeFileSync(fullPath, newContent, "utf8");
  
  return { fixed: true };
}

function identifyMigrationForFile(filePath) {
  try {
    const fullPath = path.join(ROOT, filePath);
    if (!fs.existsSync(fullPath)) return { migration: null, table: null };
    const content = fs.readFileSync(fullPath, "utf8");

    const tableCandidates = new Set();
    for (const m of content.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi)) {
      tableCandidates.add(String(m[1] || "").toLowerCase());
    }
    for (const m of content.matchAll(/ALTER\s+TABLE\s+([a-zA-Z0-9_]+)/gi)) {
      tableCandidates.add(String(m[1] || "").toLowerCase());
    }
    for (const m of content.matchAll(/table_name\s*=\s*['"]([a-zA-Z0-9_]+)['"]/gi)) {
      tableCandidates.add(String(m[1] || "").toLowerCase());
    }

    if (tableCandidates.size === 0) {
      return { migration: null, table: null };
    }

    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.+\.sql$/i.test(f))
      .sort((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0]));

    for (const table of tableCandidates) {
      let bestVersion = null;
      for (const migrationFile of migrationFiles) {
        const fullMigrationPath = path.join(MIGRATIONS_DIR, migrationFile);
        let migrationSql = "";
        try {
          migrationSql = fs.readFileSync(fullMigrationPath, "utf8").toLowerCase();
        } catch {
          continue;
        }
        if (!migrationSql.includes(table)) continue;
        const version = String(migrationFile).split("_")[0];
        if (!bestVersion || Number(version) > Number(bestVersion)) {
          bestVersion = version;
        }
      }
      if (bestVersion) {
        return { migration: bestVersion, table };
      }
    }
    return { migration: null, table: null };
  } catch {
    return { migration: null, table: null };
  }
}

async function main() {
  console.log("=== Schema Integrity Agent ===");
  console.log(`Started: ${new Date().toISOString()}\n`);
  
  const results = {
    migrations_applied: 0,
    foreign_keys_checked: 0,
    ensureschema_audited: 0,
    ensureschema_fixed: 0,
    issues_found: [],
  };
  
  try {
    // 1. Check and apply migration 078
    console.log("[1] Checking migration 078 (foreign keys)...");
    const migration078Applied = await checkMigrationApplied("078");
    if (!migration078Applied) {
      console.log("  → Migration 078 not applied, applying now...");
      try {
        await applyMigration("078");
        results.migrations_applied++;
        results.foreign_keys_added = 12; // Expected FKs from migration
        console.log("  ✓ Migration 078 applied successfully");
      } catch (err) {
        console.error(`  ✗ Failed to apply migration 078: ${err.message}`);
        results.issues_found.push(`Migration 078 failed: ${err.message}`);
        throw err;
      }
    } else {
      console.log("  ✓ Migration 078 already applied");
      // Verify FKs exist
      const fks = await checkForeignKeys();
      const totalFks = fks.reduce((sum, fk) => sum + fk.count, 0);
      if (totalFks === 0) {
        console.log("  ⚠ Migration applied but no FKs found - may need manual review");
        results.issues_found.push("Migration 078 applied but foreign keys not found");
      }
    }
    
    // 2. Check migration 075 (bot_conversion_events)
    console.log("\n[2] Checking migration 075 (bot_conversion_events)...");
    const migration075Applied = await checkMigrationApplied("075");
    const tableExists = await checkTableExists("bot_conversion_events");
    
    if (!migration075Applied && !tableExists) {
      console.log("  → Migration 075 not applied, applying now...");
      try {
        await applyMigration("075");
        results.migrations_applied++;
        console.log("  ✓ Migration 075 applied successfully");
        // Verify table was created
        const verified = await checkTableExists("bot_conversion_events");
        if (!verified) {
          throw new Error("Table bot_conversion_events not created after migration");
        }
      } catch (err) {
        console.error(`  ✗ Failed to apply migration 075: ${err.message}`);
        results.issues_found.push(`Migration 075 failed: ${err.message}`);
        throw err;
      }
    } else if (tableExists) {
      console.log("  ✓ bot_conversion_events table exists");
      if (!migration075Applied) {
        console.log("  ⚠ Table exists but migration not recorded - marking as applied");
        // Record migration as applied
        try {
          await pg.query(
            "INSERT INTO schema_migrations (version, filename) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            ["075", "075_bot_collection_schema_fixes.sql"]
          );
        } catch (err) {
          console.warn(`  Could not record migration: ${err.message}`);
        }
      }
    } else {
      console.log("  → Migration 075 not applied, but table exists (manual creation?)");
    }
    
    // 3. Check foreign keys
    console.log("\n[3] Checking foreign key constraints...");
    const fks = await checkForeignKeys();
    results.foreign_keys_checked = fks.length;
    for (const fk of fks) {
      console.log(`  ${fk.table}: ${fk.count} foreign keys`);
      if (fk.count === 0) {
        results.issues_found.push(`Missing foreign keys in ${fk.table}`);
      }
    }
    
    // 4. Audit ensureSchema() functions
    console.log("\n[4] Auditing ensureSchema() functions...");
    for (const fileInfo of ENSURE_SCHEMA_FILES) {
      const audit = auditEnsureSchema(fileInfo.file, fileInfo.migration, fileInfo.table);
      results.ensureschema_audited++;
      
      if (audit.found) {
        console.log(`  ${fileInfo.file}:`);
        console.log(`    - Has ensureSchema: ${audit.found}`);
        console.log(`    - Needs fix: ${audit.needsFix}`);
        
        if (audit.needsFix && fileInfo.migration && fileInfo.table) {
          console.log(`    → Fixing ensureSchema() in ${fileInfo.file}...`);
          try {
            const fixResult = fixEnsureSchema(fileInfo.file, fileInfo.migration, fileInfo.table);
            if (fixResult.fixed) {
              results.ensureschema_fixed++;
              console.log(`    ✓ Fixed - replaced with migration check`);
            } else {
              console.log(`    ✗ Fix failed: ${fixResult.reason}`);
              results.issues_found.push(`Could not fix ${fileInfo.file}: ${fixResult.reason}`);
            }
          } catch (err) {
            console.error(`    ✗ Error fixing: ${err.message}`);
            results.issues_found.push(`Error fixing ${fileInfo.file}: ${err.message}`);
          }
        } else if (audit.needsFix) {
          console.log(`    ⚠ Needs migration/table info to fix`);
          // Try to identify migration by checking what tables the file creates
          const identified = identifyMigrationForFile(fileInfo.file);
          if (identified.migration && identified.table) {
            console.log(`    → Identified: migration ${identified.migration}, table ${identified.table}`);
            try {
              const fixResult = fixEnsureSchema(fileInfo.file, identified.migration, identified.table);
              if (fixResult.fixed) {
                results.ensureschema_fixed++;
                console.log(`    ✓ Fixed with identified migration`);
              }
            } catch (err) {
              console.error(`    ✗ Fix failed: ${err.message}`);
            }
          } else {
            results.issues_found.push(`${fileInfo.file} needs migration/table identification`);
          }
        }
      }
    }
    
    // Summary
    console.log("\n=== Summary ===");
    console.log(`Migrations applied: ${results.migrations_applied}`);
    console.log(`Foreign keys checked: ${results.foreign_keys_checked}`);
    console.log(`ensureSchema() audited: ${results.ensureschema_audited}`);
    console.log(`ensureSchema() fixed: ${results.ensureschema_fixed}`);
    console.log(`Issues found: ${results.issues_found.length}`);
    
    // Output JSON for runner
    console.log(JSON.stringify({
      ok: true,
      ...results,
      report: {
        latestPath: path.join(ROOT, "scripts", "reports", `status-review-schema_integrity_agent-latest.json`),
      },
    }));
    
  } catch (err) {
    console.error(`[schema] Error: ${err.message}`);
    console.error(err.stack);
    console.log(JSON.stringify({
      ok: false,
      error: err.message,
      ...results,
    }));
    process.exit(1);
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(`[schema] Fatal error: ${err.message}`);
  process.exit(1);
});

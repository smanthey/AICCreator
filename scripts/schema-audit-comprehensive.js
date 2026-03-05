#!/usr/bin/env node
"use strict";

/**
 * schema-audit-comprehensive.js
 * 
 * Comprehensive database schema audit to find:
 * - Schema mismatches between migrations and code
 * - Missing tables/columns
 * - Missing indexes
 * - Foreign key issues
 * - Code references to non-existent tables/columns
 */

require("dotenv").config({ override: true });

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { glob } = require("glob");

const ROOT = path.join(__dirname, "..");

// Database connection
let pool = null;

async function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
      port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
      user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
      password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
      database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

// ─── Extract Table/Column References from Code ───────────────────────────────

async function extractTableReferences() {
  const files = await glob("**/*.{js,ts}", {
    cwd: ROOT,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  });
  
  const tableRefs = new Map(); // table -> Set of columns
  const tableQueries = new Map(); // table -> Set of query types (SELECT, INSERT, UPDATE, DELETE)
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    
    // Find table references in SQL queries
    const patterns = [
      /FROM\s+(\w+)/gi,
      /INTO\s+(\w+)/gi,
      /UPDATE\s+(\w+)/gi,
      /JOIN\s+(\w+)/gi,
      /TABLE\s+(\w+)/gi,
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const table = match[1].toLowerCase();
        if (!tableRefs.has(table)) {
          tableRefs.set(table, new Set());
          tableQueries.set(table, new Set());
        }
        
        // Determine query type
        const beforeMatch = content.substring(Math.max(0, match.index - 50), match.index);
        if (beforeMatch.match(/\bSELECT\b/i)) tableQueries.get(table).add("SELECT");
        if (beforeMatch.match(/\bINSERT\b/i)) tableQueries.get(table).add("INSERT");
        if (beforeMatch.match(/\bUPDATE\b/i)) tableQueries.get(table).add("UPDATE");
        if (beforeMatch.match(/\bDELETE\b/i)) tableQueries.get(table).add("DELETE");
      }
    }
    
    // Extract column references
    const columnPattern = /(?:SELECT|INSERT|UPDATE|SET)\s+.*?(\w+)\.(\w+)/gi;
    let colMatch;
    while ((colMatch = columnPattern.exec(content)) !== null) {
      const table = colMatch[1].toLowerCase();
      const column = colMatch[2].toLowerCase();
      if (tableRefs.has(table)) {
        tableRefs.get(table).add(column);
      }
    }
  }
  
  return { tableRefs, tableQueries };
}

// ─── Get Actual Database Schema ──────────────────────────────────────────────

async function getDatabaseSchema() {
  const pool = await getPool();
  
  // Get all tables
  const tablesResult = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  
  const tables = tablesResult.rows.map(r => r.table_name);
  const schema = new Map();
  
  for (const table of tables) {
    // Get columns
    const columnsResult = await pool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    
    // Get indexes
    const indexesResult = await pool.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [table]);
    
    // Get foreign keys
    const fkResult = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
    `, [table]);
    
    schema.set(table, {
      columns: columnsResult.rows,
      indexes: indexesResult.rows,
      foreignKeys: fkResult.rows,
    });
  }
  
  return schema;
}

// ─── Check Migration Files ───────────────────────────────────────────────────

async function getMigrationTables() {
  const migrationFiles = await glob("migrations/*.sql", { cwd: ROOT });
  const migrationTables = new Map();
  
  for (const file of migrationFiles) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    const matches = content.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi);
    
    for (const match of matches) {
      const table = match[1].toLowerCase();
      if (!migrationTables.has(table)) {
        migrationTables.set(table, []);
      }
      migrationTables.get(table).push(file);
    }
  }
  
  return migrationTables;
}

// ─── Main Audit ───────────────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Comprehensive Database Schema Audit\n");
  console.log("=" .repeat(60) + "\n");
  
  const issues = [];
  
  try {
    // 1. Extract table references from code
    console.log("1. Extracting table references from code...");
    const { tableRefs, tableQueries } = await extractTableReferences();
    console.log(`   Found ${tableRefs.size} tables referenced in code\n`);
    
    // 2. Get actual database schema
    console.log("2. Querying database schema...");
    const dbSchema = await getDatabaseSchema();
    console.log(`   Found ${dbSchema.size} tables in database\n`);
    
    // 3. Get migration tables
    console.log("3. Analyzing migration files...");
    const migrationTables = await getMigrationTables();
    console.log(`   Found ${migrationTables.size} tables in migrations\n`);
    
    // 4. Check for tables referenced in code but not in database
    console.log("\n4. Checking for missing tables...");
    for (const [table, columns] of tableRefs.entries()) {
      if (!dbSchema.has(table)) {
        issues.push({
          type: "missing_table",
          severity: "high",
          table,
          message: `Table '${table}' is referenced in code but does not exist in database`,
          queries: Array.from(tableQueries.get(table)),
        });
        console.log(`   ❌ Missing table: ${table} (used in: ${Array.from(tableQueries.get(table)).join(", ")})`);
      }
    }
    
    // 5. Check for tables in database but not in migrations
    console.log("\n5. Checking for tables without migrations...");
    for (const table of dbSchema.keys()) {
      if (!migrationTables.has(table) && !table.startsWith("pg_")) {
        issues.push({
          type: "no_migration",
          severity: "medium",
          table,
          message: `Table '${table}' exists in database but has no migration file`,
        });
        console.log(`   ⚠️  No migration: ${table}`);
      }
    }
    
    // 6. Check for missing indexes on frequently queried columns
    console.log("\n6. Checking for missing indexes...");
    for (const [table, columns] of tableRefs.entries()) {
      if (!dbSchema.has(table)) continue;
      
      const tableInfo = dbSchema.get(table);
      const indexedColumns = new Set();
      
      for (const idx of tableInfo.indexes) {
        // Extract column names from index definition
        const colMatches = idx.indexdef.match(/(\w+)/g);
        if (colMatches) {
          colMatches.forEach(col => indexedColumns.add(col.toLowerCase()));
        }
      }
      
      // Check for common query patterns that need indexes
      const queries = tableQueries.get(table);
      if (queries.has("SELECT")) {
        // Common columns that should be indexed
        const shouldBeIndexed = ["id", "created_at", "updated_at", "status", "bot_id", "platform"];
        for (const col of shouldBeIndexed) {
          if (columns.has(col) && !indexedColumns.has(col)) {
            const hasIndex = tableInfo.indexes.some(idx => 
              idx.indexdef.toLowerCase().includes(col.toLowerCase())
            );
            if (!hasIndex) {
              issues.push({
                type: "missing_index",
                severity: "medium",
                table,
                column: col,
                message: `Column '${table}.${col}' is frequently queried but not indexed`,
              });
              console.log(`   ⚠️  Missing index: ${table}.${col}`);
            }
          }
        }
      }
    }
    
    // 7. Check for foreign key mismatches
    console.log("\n7. Checking foreign key constraints...");
    for (const [table, tableInfo] of dbSchema.entries()) {
      // Check if foreign keys reference non-existent tables
      for (const fk of tableInfo.foreignKeys) {
        if (!dbSchema.has(fk.foreign_table_name)) {
          issues.push({
            type: "broken_foreign_key",
            severity: "high",
            table,
            constraint: fk.constraint_name,
            message: `Foreign key '${fk.constraint_name}' references non-existent table '${fk.foreign_table_name}'`,
          });
          console.log(`   ❌ Broken FK: ${table}.${fk.constraint_name} -> ${fk.foreign_table_name} (missing)`);
        }
      }
    }
    
    // 8. Check for column mismatches
    console.log("\n8. Checking column references...");
    for (const [table, columns] of tableRefs.entries()) {
      if (!dbSchema.has(table)) continue;
      
      const tableInfo = dbSchema.get(table);
      const dbColumns = new Set(tableInfo.columns.map(c => c.column_name.toLowerCase()));
      
      for (const col of columns) {
        if (!dbColumns.has(col) && col !== "id" && col !== "created_at" && col !== "updated_at") {
          issues.push({
            type: "missing_column",
            severity: "high",
            table,
            column: col,
            message: `Column '${table}.${col}' is referenced in code but does not exist in database`,
          });
          console.log(`   ❌ Missing column: ${table}.${col}`);
        }
      }
    }
    
    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 Audit Summary:\n");
    console.log(`   Total issues found: ${issues.length}`);
    console.log(`   High severity: ${issues.filter(i => i.severity === "high").length}`);
    console.log(`   Medium severity: ${issues.filter(i => i.severity === "medium").length}`);
    
    if (issues.length > 0) {
      console.log("\n📋 Issues by Type:\n");
      const byType = {};
      for (const issue of issues) {
        if (!byType[issue.type]) byType[issue.type] = [];
        byType[issue.type].push(issue);
      }
      
      for (const [type, typeIssues] of Object.entries(byType)) {
        console.log(`   ${type}: ${typeIssues.length}`);
        for (const issue of typeIssues.slice(0, 5)) {
          console.log(`      - ${issue.message}`);
        }
        if (typeIssues.length > 5) {
          console.log(`      ... and ${typeIssues.length - 5} more`);
        }
      }
      
      // Save detailed report
      const reportPath = path.join(ROOT, "schema-audit-report.json");
      fs.writeFileSync(reportPath, JSON.stringify(issues, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    } else {
      console.log("\n✅ No schema issues found!");
    }
    
  } catch (err) {
    console.error("\n❌ Audit failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = { main };

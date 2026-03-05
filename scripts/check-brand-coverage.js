#!/usr/bin/env node
/**
 * check-brand-coverage.js
 * ──────────────────────────────────────────────────────────────────────────
 * Reports brand coverage in claw.files and optionally runs migration 019.
 *
 * Usage:
 *   node scripts/check-brand-coverage.js          # show stats
 *   node scripts/check-brand-coverage.js --apply  # run 019 if not applied
 *   node scripts/check-brand-coverage.js --top    # show top brands
 */

"use strict";

const path = require("path");
const fs   = require("fs");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host:     process.env.CLAW_DB_HOST     || "192.168.1.164",
  port:     parseInt(process.env.CLAW_DB_PORT || "15432"),
  user:     process.env.POSTGRES_USER    || "claw",
  password: process.env.POSTGRES_PASSWORD|| process.env.CLAW_DB_PASSWORD,
  database: process.env.CLAW_DB_NAME || "claw_architect",
});

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const TOP   = args.includes("--top");

async function main() {
  // ── 1. Coverage overview ────────────────────────────────────────────────
  const { rows: [cov] } = await pool.query(`
    SELECT
      COUNT(*)                              AS total,
      COUNT(brand)                          AS branded,
      COUNT(*) - COUNT(brand)               AS unbranded,
      ROUND(COUNT(brand)::numeric / COUNT(*) * 100, 1) AS pct
    FROM files
  `);
  console.log("\n📊 Brand coverage:");
  console.log(`   Total files : ${Number(cov.total).toLocaleString()}`);
  console.log(`   Branded     : ${Number(cov.branded).toLocaleString()} (${cov.pct}%)`);
  console.log(`   Unbranded   : ${Number(cov.unbranded).toLocaleString()}`);

  // ── 2. Top brands ────────────────────────────────────────────────────────
  if (TOP || true) {
    const { rows: brands } = await pool.query(`
      SELECT brand, COUNT(*) AS cnt
      FROM files WHERE brand IS NOT NULL
      GROUP BY brand ORDER BY cnt DESC LIMIT 30
    `);
    console.log("\n🏷️  Top brands:");
    brands.forEach(b =>
      console.log(`   ${b.brand.padEnd(22)} ${Number(b.cnt).toLocaleString().padStart(8)} files`)
    );
  }

  // ── 3. Optionally apply migration 019 ────────────────────────────────────
  if (APPLY) {
    const sqlPath = path.join(__dirname, "../migrations/019_expand_brand_patterns.sql");
    if (!fs.existsSync(sqlPath)) {
      console.error("\n❌ Migration 019 file not found:", sqlPath);
      process.exit(1);
    }
    console.log("\n🔧 Applying migration 019...");
    const sql = fs.readFileSync(sqlPath, "utf8");
    const before = await pool.query("SELECT COUNT(*) FROM files WHERE brand IS NULL");
    const result = await pool.query(sql);
    const after  = await pool.query("SELECT COUNT(*) FROM files WHERE brand IS NULL");
    const patched = Number(before.rows[0].count) - Number(after.rows[0].count);
    console.log(`   ✅ Done — ${patched.toLocaleString()} rows branded`);
    console.log(`   Unbranded remaining: ${Number(after.rows[0].count).toLocaleString()}`);
  }

  // ── 4. Unbranded sample (top path prefixes) ──────────────────────────────
  if (Number(cov.unbranded) > 0) {
    const { rows: sample } = await pool.query(`
      SELECT
        split_part(path, '/', 4) AS folder,
        COUNT(*) AS cnt
      FROM files
      WHERE brand IS NULL
      GROUP BY folder ORDER BY cnt DESC LIMIT 15
    `);
    console.log(`\n🔍 Top unbranded path prefixes (${Number(cov.unbranded).toLocaleString()} total):`);
    sample.forEach(r =>
      console.log(`   ${(r.folder || '(blank)').padEnd(30)} ${Number(r.cnt).toLocaleString().padStart(8)} files`)
    );
  }

  await pool.end();
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });

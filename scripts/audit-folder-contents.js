#!/usr/bin/env node
/**
 * audit-folder-contents.js
 * ──────────────────────────────────────────────────────────────────────────
 * Deep breakdown of what's actually inside the large unbranded folders:
 * Movies, Desktop, Downloads, Documents, Dropbox, iCloud Archive
 *
 * Run: node scripts/audit-folder-contents.js
 * Run: node scripts/audit-folder-contents.js --folder Movies
 */
"use strict";

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host:     process.env.CLAW_DB_HOST      || "192.168.1.164",
  port:     parseInt(process.env.CLAW_DB_PORT || "15432"),
  user:     process.env.POSTGRES_USER     || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.CLAW_DB_NAME || "claw_architect",
});

const TARGET_FOLDER = (() => {
  const i = process.argv.indexOf("--folder");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const FOLDERS = TARGET_FOLDER
  ? [TARGET_FOLDER]
  : ["Movies", "Desktop", "Downloads", "Documents", "Dropbox", "Music",
     "iCloud Drive (Archive) - 1", "Pictures"];

async function auditFolder(folder) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(` 📁 ${folder}`);
  console.log("═".repeat(60));

  // ── Overall stats ─────────────────────────────────────────────────────
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*)                                    AS total,
      ROUND(SUM(size_bytes)/1e9::numeric, 2)      AS total_gb,
      COUNT(brand)                                AS branded,
      COUNT(*) - COUNT(brand)                     AS unbranded,
      COUNT(*) FILTER (WHERE category IS NULL)    AS uncategorized
    FROM files
    WHERE split_part(path, '/', 4) = $1
  `, [folder]);

  if (Number(stats.total) === 0) {
    console.log("  (no files found at depth 4)\n");
    return;
  }

  console.log(`  Total     : ${Number(stats.total).toLocaleString()} files | ${stats.total_gb} GB`);
  console.log(`  Branded   : ${Number(stats.branded).toLocaleString()}`);
  console.log(`  Unbranded : ${Number(stats.unbranded).toLocaleString()}`);
  console.log(`  No category: ${Number(stats.uncategorized).toLocaleString()}`);

  // ── Category breakdown ────────────────────────────────────────────────
  const { rows: cats } = await pool.query(`
    SELECT
      COALESCE(category, 'uncategorized') AS category,
      COUNT(*)                             AS cnt,
      ROUND(SUM(size_bytes)/1e9::numeric, 2) AS gb
    FROM files
    WHERE split_part(path, '/', 4) = $1
    GROUP BY category ORDER BY cnt DESC
  `, [folder]);

  console.log("\n  By category:");
  cats.forEach(r =>
    console.log(`    ${r.category.padEnd(18)} ${r.cnt.toString().padStart(8)} files | ${String(r.gb).padStart(7)} GB`)
  );

  // ── Top file extensions ───────────────────────────────────────────────
  const { rows: exts } = await pool.query(`
    SELECT ext, COUNT(*) cnt, ROUND(SUM(size_bytes)/1e9::numeric, 3) gb
    FROM files
    WHERE split_part(path, '/', 4) = $1
      AND ext IS NOT NULL AND ext != ''
    GROUP BY ext ORDER BY cnt DESC LIMIT 20
  `, [folder]);

  console.log("\n  Top extensions:");
  exts.forEach(r =>
    console.log(`    .${r.ext.padEnd(15)} ${r.cnt.toString().padStart(8)} files | ${String(r.gb).padStart(7)} GB`)
  );

  // ── Sub-folders (depth 5) ─────────────────────────────────────────────
  const { rows: subs } = await pool.query(`
    SELECT
      split_part(path, '/', 5)              AS subfolder,
      COUNT(*)                               AS cnt,
      ROUND(SUM(size_bytes)/1e9::numeric, 2) AS gb,
      COUNT(DISTINCT brand)                  AS brands,
      (array_agg(brand ORDER BY brand NULLS LAST))[1] AS top_brand
    FROM files
    WHERE split_part(path, '/', 4) = $1
      AND split_part(path, '/', 5) != ''
    GROUP BY subfolder
    ORDER BY cnt DESC
    LIMIT 30
  `, [folder]);

  if (subs.length > 0) {
    console.log("\n  Sub-folders (top 30):");
    subs.forEach(r => {
      const brandNote = r.top_brand ? ` [${r.top_brand}]` : "";
      console.log(
        `    /${r.subfolder.slice(0,35).padEnd(36)}`
        + ` ${r.cnt.toString().padStart(7)} files | ${String(r.gb).padStart(6)} GB${brandNote}`
      );
    });
  }

  // ── Source machines ───────────────────────────────────────────────────
  const { rows: machines } = await pool.query(`
    SELECT source_machine, COUNT(*) cnt
    FROM files WHERE split_part(path, '/', 4) = $1
    GROUP BY source_machine ORDER BY cnt DESC
  `, [folder]);

  console.log("\n  From machines:");
  machines.forEach(r =>
    console.log(`    ${r.source_machine.padEnd(20)} ${r.cnt.toString().padStart(8)} files`)
  );
}

async function summary() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" FULL DATABASE CATEGORY SNAPSHOT");
  console.log("══════════════════════════════════════════════════════════════");

  const { rows } = await pool.query(`
    SELECT
      COALESCE(category, 'uncategorized') AS category,
      COUNT(*)                             AS cnt,
      ROUND(SUM(size_bytes)/1e9::numeric, 2) AS gb,
      COUNT(DISTINCT brand)                AS brand_count
    FROM files
    GROUP BY category
    ORDER BY cnt DESC
  `);

  let totalFiles = 0, totalGb = 0;
  rows.forEach(r => {
    console.log(
      `  ${r.category.padEnd(20)} ${r.cnt.toString().padStart(9)} files | `
      + `${String(r.gb).padStart(8)} GB | ${r.brand_count} brands`
    );
    totalFiles += Number(r.cnt);
    totalGb    += Number(r.gb);
  });
  console.log("─".repeat(62));
  console.log(`  ${"TOTAL".padEnd(20)} ${totalFiles.toLocaleString().padStart(9)} files | ${totalGb.toFixed(2).padStart(8)} GB`);
}

async function main() {
  await summary();
  for (const folder of FOLDERS) {
    await auditFolder(folder);
  }
  await pool.end();
  console.log("\n");
}

main().catch(e => { console.error(e); process.exit(1); });

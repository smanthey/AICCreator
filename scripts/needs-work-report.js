#!/usr/bin/env node
/**
 * needs-work-report.js
 * ──────────────────────────────────────────────────────────────────────────
 * Standalone "what still needs attention" report.
 * Reads current DB state and produces a clear prioritized list.
 * No writes. Safe to run any time.
 *
 * Usage:
 *   node scripts/needs-work-report.js              # full report
 *   node scripts/needs-work-report.js --brand smat # one brand only
 *   node scripts/needs-work-report.js --ios        # iOS apps only
 *   node scripts/needs-work-report.js --ariel      # Ariel's 3D work only
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

const BRAND_FILTER = (() => { const i = process.argv.indexOf("--brand"); return i>=0 ? process.argv[i+1] : null; })();
const IOS_ONLY     = process.argv.includes("--ios");
const ARIEL_ONLY   = process.argv.includes("--ariel");

function bar(n, total, width=20) {
  const filled = Math.round((n / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           NEEDS-WORK REPORT  —  ClawdBot File System        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── 1. Top-line health snapshot ─────────────────────────────────────────
  const { rows: [snap] } = await pool.query(`
    SELECT
      COUNT(*) total,
      COUNT(brand) branded,
      COUNT(category) categorized,
      COUNT(sub_category) sub_categorized,
      COUNT(*) FILTER (WHERE work_needed IS NOT NULL) needs_work,
      COUNT(*) FILTER (WHERE category = 'unknown') unknown_cat,
      COUNT(*) FILTER (WHERE category IS NULL) null_cat,
      COUNT(*) FILTER (WHERE category = 'ios_app') ios_total,
      COUNT(*) FILTER (WHERE brand = 'ariel' OR category = '3d_asset') ariel_total,
      ROUND(SUM(size_bytes)/1e12::numeric, 2) total_tb
    FROM files WHERE review_status != 'ignored'
  `);

  const total = Number(snap.total);
  console.log(`  📦 Total indexed files : ${total.toLocaleString()}  (${snap.total_tb} TB)`);
  console.log(`  🏷️  Branded             : ${Number(snap.branded).toLocaleString().padStart(9)}  ${bar(snap.branded, total)} ${(snap.branded/total*100).toFixed(1)}%`);
  console.log(`  📂 Categorized          : ${Number(snap.categorized).toLocaleString().padStart(9)}  ${bar(snap.categorized, total)} ${(snap.categorized/total*100).toFixed(1)}%`);
  console.log(`  🔬 Sub-categorized      : ${Number(snap.sub_categorized).toLocaleString().padStart(9)}  ${bar(snap.sub_categorized, total)} ${(snap.sub_categorized/total*100).toFixed(1)}%`);
  console.log(`  🚧 Needs work           : ${Number(snap.needs_work).toLocaleString().padStart(9)}`);
  console.log(`  ❓ Unknown category     : ${Number(snap.unknown_cat).toLocaleString().padStart(9)}`);
  console.log(`  📵 No category yet      : ${Number(snap.null_cat).toLocaleString().padStart(9)}`);
  console.log(`  📱 iOS app files        : ${Number(snap.ios_total).toLocaleString().padStart(9)}`);
  console.log(`  🎨 Ariel / 3D files     : ${Number(snap.ariel_total).toLocaleString().padStart(9)}`);

  // ── 2. Priority work queue ──────────────────────────────────────────────
  console.log("\n  ┌─────────────────────────────────────────────────────────┐");
  console.log("  │  PRIORITY WORK QUEUE (ordered highest impact first)     │");
  console.log("  └─────────────────────────────────────────────────────────┘\n");

  const PRIORITIES = [
    { label: "No category at all",       q: `category IS NULL AND review_status != 'ignored'` },
    { label: "Unknown category",          q: `category = 'unknown'` },
    { label: "Has category, no brand",    q: `category IS NOT NULL AND category != 'cache' AND brand IS NULL` },
    { label: "Low confidence category",   q: `category_confidence < 0.7 AND category_confidence IS NOT NULL` },
    { label: "iOS apps (need updating)",  q: `category = 'ios_app'` },
    { label: "3D assets (Ariel's work)",  q: `category = '3d_asset' OR brand = 'ariel'` },
    { label: "Needs sub-category",        q: `category IS NOT NULL AND sub_category IS NULL AND category NOT IN ('cache','font','archive') AND review_status != 'ignored'` },
    { label: "In dedup (likely dupes)",   q: `work_needed LIKE '%likely_duplicate%'` },
    { label: "Large + unreviewed >500MB", q: `size_bytes > 500000000 AND (category IS NULL OR category = 'unknown')` },
  ];

  let rank = 1;
  for (const p of PRIORITIES) {
    const brandClause = BRAND_FILTER ? ` AND brand = '${BRAND_FILTER}'` : "";
    const { rows: [{ cnt, gb }] } = await pool.query(
      `SELECT COUNT(*) cnt, ROUND(SUM(size_bytes)/1e9::numeric,1) gb FROM files WHERE ${p.q}${brandClause}`
    );
    if (Number(cnt) === 0) continue;
    console.log(`  ${String(rank).padStart(2)}. ${p.label.padEnd(36)} ${Number(cnt).toLocaleString().padStart(9)} files  ${String(gb||0).padStart(7)} GB`);
    rank++;
  }

  if (!IOS_ONLY && !ARIEL_ONLY) {

    // ── 3. Brand health table ─────────────────────────────────────────────
    console.log("\n  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  BRAND HEALTH (brands with missing data)                │");
    console.log("  └─────────────────────────────────────────────────────────┘\n");

    const brandQ = BRAND_FILTER ? `WHERE brand = '${BRAND_FILTER}'` : "WHERE brand IS NOT NULL";
    const { rows: brands } = await pool.query(`
      SELECT
        brand,
        COUNT(*) total,
        COUNT(category) categorized,
        COUNT(sub_category) sub_cat,
        COUNT(*) FILTER (WHERE category = 'unknown') unknown_c,
        COUNT(*) FILTER (WHERE category IS NULL) no_cat,
        COUNT(*) FILTER (WHERE category = 'ios_app') ios_c,
        COUNT(*) FILTER (WHERE category = '3d_asset') asset_3d,
        ROUND(SUM(size_bytes)/1e6::numeric,0) mb
      FROM files ${brandQ}
      GROUP BY brand
      HAVING COUNT(*) FILTER (WHERE category IS NULL OR category = 'unknown') > 0
          OR COUNT(*) FILTER (WHERE category = 'ios_app') > 0
      ORDER BY (COUNT(*) FILTER (WHERE category IS NULL OR category = 'unknown')) DESC
      LIMIT 30
    `);

    console.log(`  ${"Brand".padEnd(22)} ${"Total".padStart(7)} ${"NoCat".padStart(7)} ${"Unknown".padStart(8)} ${"iOS".padStart(6)} ${"MB".padStart(9)}`);
    console.log("  " + "─".repeat(65));
    brands.forEach(r =>
      console.log(`  ${r.brand.padEnd(22)} ${r.total.toString().padStart(7)} ${r.no_cat.toString().padStart(7)} ${r.unknown_c.toString().padStart(8)} ${r.ios_c.toString().padStart(6)} ${r.mb.toString().padStart(9)}`)
    );

    // ── 4. Folder trouble spots ───────────────────────────────────────────
    console.log("\n  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  FOLDER TROUBLE SPOTS (unbranded + uncategorized)       │");
    console.log("  └─────────────────────────────────────────────────────────┘\n");

    const { rows: folders } = await pool.query(`
      SELECT
        split_part(path, '/', 4) folder,
        COUNT(*) total,
        COUNT(*) FILTER (WHERE brand IS NULL) no_brand,
        COUNT(*) FILTER (WHERE category IS NULL OR category = 'unknown') no_cat,
        ROUND(SUM(size_bytes)/1e9::numeric, 2) gb
      FROM files
      WHERE (brand IS NULL OR category IS NULL OR category = 'unknown')
        AND review_status != 'ignored'
        AND split_part(path, '/', 4) != ''
      GROUP BY folder
      HAVING COUNT(*) > 100
      ORDER BY (COUNT(*) FILTER (WHERE category IS NULL OR category = 'unknown')) DESC
      LIMIT 20
    `);

    folders.forEach(r =>
      console.log(`  /${r.folder.padEnd(30)} ${r.total.toString().padStart(8)} total | no brand: ${r.no_brand.toString().padStart(7)} | no cat: ${r.no_cat.toString().padStart(7)} | ${r.gb} GB`)
    );
  }

  // ── 5. iOS app detail ─────────────────────────────────────────────────
  if (IOS_ONLY || Number(snap.ios_total) > 0) {
    console.log("\n  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  iOS APPS — detail                                      │");
    console.log("  └─────────────────────────────────────────────────────────┘\n");

    const { rows: iosApps } = await pool.query(`
      SELECT
        brand,
        sub_category,
        COUNT(*) cnt,
        COUNT(*) FILTER (WHERE ext = 'ipa') ipa_count,
        COUNT(*) FILTER (WHERE ext IN ('swift','m','h')) source_files,
        ROUND(SUM(size_bytes)/1e6::numeric,0) mb,
        source_machine
      FROM files WHERE category = 'ios_app'
      GROUP BY brand, sub_category, source_machine
      ORDER BY brand, cnt DESC
    `);
    iosApps.forEach(r =>
      console.log(`  ${(r.brand||'(no brand)').padEnd(20)} ${(r.sub_category||'?').padEnd(16)} ${r.cnt.toString().padStart(6)} files | ${r.ipa_count} .ipa | ${r.source_files} src | ${r.mb}MB | ${r.source_machine}`)
    );
  }

  // ── 6. Ariel's 3D detail ──────────────────────────────────────────────
  if (ARIEL_ONLY || Number(snap.ariel_total) > 0) {
    console.log("\n  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  ARIEL'S 3D WORK — detail                               │");
    console.log("  └─────────────────────────────────────────────────────────┘\n");

    const { rows: ariel3d } = await pool.query(`
      SELECT
        ext,
        sub_category,
        COUNT(*) cnt,
        ROUND(SUM(size_bytes)/1e9::numeric, 3) gb,
        source_machine
      FROM files
      WHERE brand = 'ariel' OR category = '3d_asset'
      GROUP BY ext, sub_category, source_machine
      ORDER BY cnt DESC LIMIT 30
    `);
    ariel3d.forEach(r =>
      console.log(`  .${(r.ext||'?').padEnd(12)} ${(r.sub_category||'unclassified').padEnd(20)} ${r.cnt.toString().padStart(7)} files | ${r.gb} GB | ${r.source_machine}`)
    );
  }

  // ── 7. Next steps recommendation ─────────────────────────────────────
  console.log("\n  ┌─────────────────────────────────────────────────────────┐");
  console.log("  │  RECOMMENDED NEXT STEPS                                 │");
  console.log("  └─────────────────────────────────────────────────────────┘\n");

  const noCat  = Number(snap.null_cat);
  const unkCat = Number(snap.unknown_cat);
  const iosC   = Number(snap.ios_total);

  if (noCat > 1000)  console.log(`  ⚠️  Run migration 022 (extension-based mass categorization) → will clear ${noCat.toLocaleString()} null-category files`);
  if (unkCat > 1000) console.log(`  ⚠️  ${unkCat.toLocaleString()} files still 'unknown' after extension pass → run deep-categorizer.js --ollama for these`);
  if (iosC > 0)      console.log(`  📱 ${iosC.toLocaleString()} iOS app files found → ready for ios-audit-agent once categorization is stable`);
  console.log(`  🔄 When categorization finishes → run deep-categorizer.js (no flags) to set sub_category + work_needed`);
  console.log(`  📋 After deep-categorizer → run this report again for final picture before any dedup or migration`);
  console.log(`  🎨 Ariel's 3D work → review sub-categories above before organizing into NAS folder structure`);
  console.log();

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

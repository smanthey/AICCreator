#!/usr/bin/env node
// scripts/run-dedup.js
// DB-powered duplicate detection — fully set-based SQL, completes in seconds.
//
// PASS 1 — Exact SHA-256 match across local machines (confirmed duplicates)
// PASS 2 — Filename + size_bytes match between nas_primary and local machines
//           (probable duplicates: NAS already has a copy)
//
// Canonical priority (which copy to KEEP):
//   nas_primary > m4_local > m4_laptop > m1_mac_mini > laptop_1 > machine
//
// Usage:
//   node scripts/run-dedup.js               -- full sweep + DB write
//   node scripts/run-dedup.js --dry-run     -- counts only, no DB writes
//   node scripts/run-dedup.js --clear       -- wipe previous results first
//   node scripts/run-dedup.js --summary     -- show existing results

"use strict";

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.CLAW_DB_HOST     || process.env.POSTGRES_HOST     || "192.168.1.164",
  port:     Number(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT  || 15432),
  user:     process.env.CLAW_DB_USER     || process.env.POSTGRES_USER     || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.CLAW_DB_NAME || "claw",
  max: 3,
  statement_timeout: 300000,           // 5-min cap per query
  connectionTimeoutMillis: 20000,
});

const DRY_RUN = process.argv.includes("--dry-run");
const CLEAR   = process.argv.includes("--clear");
const SUMMARY = process.argv.includes("--summary");

// Machine preference as a SQL CASE expression (lower = higher priority)
const MACHINE_RANK_SQL = `
  CASE source_machine
    WHEN 'nas_primary' THEN 0
    WHEN 'm4_local'    THEN 1
    WHEN 'm4_laptop'   THEN 2
    WHEN 'm1_mac_mini' THEN 3
    WHEN 'laptop_1'    THEN 4
    WHEN 'machine'     THEN 5
    ELSE 99
  END`;
const EXCLUDE_QUARANTINE_SQL = `path NOT LIKE '%/claw-quarantine/%'`;

function fmt(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────
async function showSummary(client) {
  const { rows: [o] } = await client.query(`
    SELECT
      COUNT(*)                                                     AS total_groups,
      COALESCE(SUM(file_count), 0)                                 AS total_dupe_files,
      COALESCE(SUM(wasted_bytes), 0)                               AS total_wasted,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)        AS confirmed,
      SUM(CASE WHEN status = 'probable'  THEN 1 ELSE 0 END)        AS probable
    FROM duplicate_groups
  `);

  const { rows: byBrand } = await client.query(`
    SELECT brand, COUNT(*) AS groups, SUM(wasted_bytes) AS wasted
    FROM duplicate_groups
    WHERE brand IS NOT NULL
    GROUP BY brand ORDER BY wasted DESC NULLS LAST LIMIT 15
  `);

  const { rows: byMachine } = await client.query(`
    SELECT f.source_machine, COUNT(*) AS redundant_files,
      SUM(f.size_bytes) AS redundant_bytes
    FROM duplicate_group_members dgm
    JOIN files f ON f.id = dgm.file_id
    JOIN duplicate_groups dg ON dg.id = dgm.group_id
    WHERE f.id != dg.canonical_file_id
    GROUP BY f.source_machine ORDER BY redundant_bytes DESC
  `);

  console.log("\n📊 Duplicate Detection Results");
  console.log("══════════════════════════════════════════════");
  console.log(`  Duplicate groups:        ${parseInt(o.total_groups).toLocaleString()}`);
  console.log(`  Total redundant files:   ${parseInt(o.total_dupe_files).toLocaleString()}`);
  console.log(`  Recoverable space:       ${fmt(o.total_wasted)}`);
  console.log(`  Confirmed (SHA-256):     ${parseInt(o.confirmed).toLocaleString()}`);
  console.log(`  Probable  (name+size):   ${parseInt(o.probable).toLocaleString()}`);

  if (byBrand.length) {
    console.log("\n  Wasted space by brand:");
    for (const r of byBrand) {
      const name = (r.brand || "unknown").padEnd(16);
      console.log(`    ${name}  ${String(r.groups).padStart(5)} groups   ${fmt(r.wasted)}`);
    }
  }

  if (byMachine.length) {
    console.log("\n  Redundant copies by machine (safe to remove after NAS reorganization):");
    for (const r of byMachine) {
      const m = r.source_machine.padEnd(14);
      console.log(`    ${m}  ${parseInt(r.redundant_files).toLocaleString().padStart(7)} files   ${fmt(r.redundant_bytes)}`);
    }
  }
  console.log("");
}

// ── PASS 1: Confirmed SHA-256 duplicates (local machines only) ───────────────
async function pass1(client) {
  console.log("\n🔍 Pass 1: Confirmed SHA-256 duplicates (local machines)...");

  // Step 1a: Insert groups using set-based CTE — one query for all 34k groups
  const { rowCount: groupsInserted } = await client.query(`
    WITH
    -- Find all sha256 values that appear on more than one local file
    dupes AS (
      SELECT
        sha256,
        COUNT(*)                                                AS file_count,
        MAX(size_bytes)                                         AS size_bytes,
        (array_agg(brand    ORDER BY brand    NULLS LAST))[1]  AS brand,
        (array_agg(category ORDER BY category NULLS LAST))[1]  AS category
      FROM files
      WHERE source_machine != 'nas_primary'
        AND ${EXCLUDE_QUARANTINE_SQL}
      GROUP BY sha256
      HAVING COUNT(*) > 1
    ),
    -- Pick the best canonical copy per sha256 using machine priority
    canonical AS (
      SELECT DISTINCT ON (f.sha256)
        f.id, f.sha256
      FROM files f
      JOIN dupes d ON d.sha256 = f.sha256
      WHERE f.source_machine != 'nas_primary'
        AND f.${EXCLUDE_QUARANTINE_SQL}
      ORDER BY f.sha256, ${MACHINE_RANK_SQL}, f.indexed_at DESC
    )
    INSERT INTO duplicate_groups
      (sha256, file_count, canonical_file_id, status, wasted_bytes, brand, category)
    SELECT
      d.sha256,
      d.file_count,
      c.id,
      'confirmed',
      d.size_bytes * (d.file_count - 1),
      d.brand,
      d.category
    FROM dupes d
    JOIN canonical c ON c.sha256 = d.sha256
    ON CONFLICT (sha256) DO UPDATE SET
      file_count        = EXCLUDED.file_count,
      canonical_file_id = EXCLUDED.canonical_file_id,
      wasted_bytes      = EXCLUDED.wasted_bytes,
      brand             = EXCLUDED.brand,
      category          = EXCLUDED.category
  `);

  // Step 1b: Insert all members in one query
  const { rowCount: membersInserted } = await client.query(`
    INSERT INTO duplicate_group_members (group_id, file_id)
    SELECT dg.id, f.id
    FROM duplicate_groups dg
    JOIN files f ON f.sha256 = dg.sha256
    WHERE dg.status = 'confirmed'
      AND f.source_machine != 'nas_primary'
      AND f.${EXCLUDE_QUARANTINE_SQL}
    ON CONFLICT DO NOTHING
  `);

  // Get wasted bytes total
  const { rows: [{ wasted }] } = await client.query(`
    SELECT COALESCE(SUM(wasted_bytes), 0) AS wasted
    FROM duplicate_groups WHERE status = 'confirmed'
  `);

  console.log(`  ✓ ${groupsInserted.toLocaleString()} groups, ${membersInserted.toLocaleString()} member rows — ${fmt(wasted)} recoverable`);
  return { groups: groupsInserted, wasted: BigInt(wasted || 0) };
}

// ── PASS 2: Probable duplicates — NAS file already exists locally ─────────────
async function pass2(client) {
  console.log("\n🔍 Pass 2: Probable duplicates — NAS copies vs local machines (filename + size)...");

  // Step 2a: Insert probable groups — NAS file is always canonical
  const { rowCount: groupsInserted } = await client.query(`
    WITH nas_matches AS (
      SELECT
        nas.id                                                       AS nas_id,
        nas.sha256                                                   AS nas_sha256,
        nas.size_bytes,
        nas.brand                                                    AS brand,
        nas.category                                                 AS category,
        COUNT(local.id)                                              AS local_count
      FROM files nas
      JOIN files local
        ON  local.filename     = nas.filename
        AND local.size_bytes   = nas.size_bytes
        AND local.source_machine != 'nas_primary'
        AND local.${EXCLUDE_QUARANTINE_SQL}
      WHERE nas.source_machine = 'nas_primary'
      GROUP BY nas.id, nas.sha256, nas.size_bytes, nas.brand, nas.category
    )
    INSERT INTO duplicate_groups
      (sha256, file_count, canonical_file_id, status, wasted_bytes, brand, category, nas_copy_id)
    SELECT
      nas_sha256,
      local_count + 1,
      nas_id,
      'probable',
      size_bytes * local_count,
      brand,
      category,
      nas_id
    FROM nas_matches
    ON CONFLICT (sha256) DO UPDATE SET
      file_count        = EXCLUDED.file_count,
      canonical_file_id = EXCLUDED.canonical_file_id,
      wasted_bytes      = EXCLUDED.wasted_bytes,
      nas_copy_id       = EXCLUDED.nas_copy_id
  `);

  // Step 2b: NAS files themselves as members
  await client.query(`
    INSERT INTO duplicate_group_members (group_id, file_id)
    SELECT dg.id, dg.nas_copy_id
    FROM duplicate_groups dg
    WHERE dg.status = 'probable' AND dg.nas_copy_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  // Step 2c: Local matching files as members
  const { rowCount: localMembers } = await client.query(`
    INSERT INTO duplicate_group_members (group_id, file_id)
    SELECT dg.id, local.id
    FROM duplicate_groups dg
    JOIN files nas  ON nas.id = dg.nas_copy_id
    JOIN files local
      ON  local.filename     = nas.filename
      AND local.size_bytes   = nas.size_bytes
      AND local.source_machine != 'nas_primary'
      AND local.${EXCLUDE_QUARANTINE_SQL}
    WHERE dg.status = 'probable'
    ON CONFLICT DO NOTHING
  `);

  const { rows: [{ wasted }] } = await client.query(`
    SELECT COALESCE(SUM(wasted_bytes), 0) AS wasted
    FROM duplicate_groups WHERE status = 'probable'
  `);

  console.log(`  ✓ ${groupsInserted.toLocaleString()} groups, ${localMembers.toLocaleString()} local-copy members — ${fmt(wasted)} recoverable`);
  return { groups: groupsInserted, wasted: BigInt(wasted || 0) };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log(`\n🔁 Claw Dedup Engine  (${DRY_RUN ? "DRY RUN" : "LIVE"})`);
    console.log(`   DB: ${pool.options.host}:${pool.options.port}/${pool.options.database}\n`);

    const preflight = await client.query(
      `SELECT to_regclass('public.files') AS files_tbl,
              to_regclass('public.duplicate_groups') AS groups_tbl,
              to_regclass('public.duplicate_group_members') AS members_tbl`
    );
    const pf = preflight.rows[0] || {};
    if (!pf.files_tbl || !pf.groups_tbl || !pf.members_tbl) {
      throw new Error(
        `dedupe tables not found in DB "${pool.options.database}". ` +
        `Set CLAW_DB_NAME=claw (current=${pool.options.database || "unknown"}).`
      );
    }

    if (SUMMARY) {
      await showSummary(client);
      return;
    }

    if (DRY_RUN) {
      const { rows: [c1] } = await client.query(`
        SELECT COUNT(*)::bigint AS groups
        FROM (
          SELECT sha256
          FROM files
          WHERE source_machine != 'nas_primary'
            AND ${EXCLUDE_QUARANTINE_SQL}
          GROUP BY sha256
          HAVING COUNT(*) > 1
        ) t
      `).catch(() => ({ rows: [{ groups: 0 }] }));

      const { rows: [c2] } = await client.query(`
        SELECT COUNT(DISTINCT nas.id) AS probable_groups
        FROM files nas
        JOIN files local ON local.filename = nas.filename
          AND local.size_bytes = nas.size_bytes
          AND local.source_machine != 'nas_primary'
          AND local.${EXCLUDE_QUARANTINE_SQL}
        WHERE nas.source_machine = 'nas_primary'
      `).catch(() => ({ rows: [{ probable_groups: 0 }] }));

      // Wasted space estimate
      const { rows: [ws] } = await client.query(`
        SELECT SUM(size_bytes * (cnt - 1)) AS wasted FROM (
          SELECT sha256, MAX(size_bytes) AS size_bytes, COUNT(*) AS cnt
          FROM files WHERE source_machine != 'nas_primary'
            AND ${EXCLUDE_QUARANTINE_SQL}
          GROUP BY sha256 HAVING COUNT(*) > 1
        ) t
      `);

      console.log(`  Pass 1 (confirmed):  ${parseInt(c1.groups || 0).toLocaleString()} groups`);
      console.log(`  Pass 2 (probable):   ${parseInt(c2.probable_groups || 0).toLocaleString()} NAS matches`);
      console.log(`  Estimated wasted:    ${fmt(ws?.wasted || 0)}`);
      console.log("\n  (dry run — no DB writes)");
      return;
    }

    if (CLEAR) {
      await client.query(`TRUNCATE duplicate_groups RESTART IDENTITY CASCADE`);
      console.log("  ✓ Cleared previous results\n");
    }

    const start = Date.now();
    const p1 = await pass1(client);
    const p2 = await pass2(client);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`\n✅ Done in ${elapsed}s`);
    console.log(`   ${(p1.groups + p2.groups).toLocaleString()} total groups  |  ${fmt(p1.wasted + p2.wasted)} recoverable`);

    await showSummary(client);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});

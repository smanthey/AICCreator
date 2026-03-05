// agents/dedupe-agent.js
// DB-powered duplicate detection — delegates to the same SQL logic as run-dedup.js
// but runs as a BullMQ task so the planner can trigger it on demand.
//
// Task type: "dedupe"
//
// Payload options:
//   {}                    -- full sweep (confirmed + probable), keeps existing results
//   { clear: true }       -- wipe previous results first, then full sweep
//   { summary: true }     -- return summary of existing duplicate_groups, no new scan
//
// Returns:
//   { confirmed_groups, probable_groups, total_groups, recoverable_gb,
//     top_brands, by_machine, cost_usd, model_used }

"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { register } = require("./registry");

const pool = new Pool({
  host:     process.env.CLAW_DB_HOST     || process.env.POSTGRES_HOST     || "192.168.1.164",
  port:     Number(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT  || 15432),
  user:     process.env.CLAW_DB_USER     || process.env.POSTGRES_USER     || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.CLAW_DB_NAME     || "claw_architect",
  max: 3,
  statement_timeout: 300000,
  connectionTimeoutMillis: 20000,
});

// Machine priority for canonical selection (lower = preferred)
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

async function getSummary(client) {
  const { rows: [o] } = await client.query(`
    SELECT
      COUNT(*)                                                   AS total_groups,
      COALESCE(SUM(file_count), 0)                               AS total_files,
      COALESCE(SUM(wasted_bytes), 0)                             AS total_wasted,
      SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END)        AS confirmed,
      SUM(CASE WHEN status='probable'  THEN 1 ELSE 0 END)        AS probable
    FROM duplicate_groups
  `);

  const { rows: byBrand } = await client.query(`
    SELECT brand, COUNT(*) AS groups, SUM(wasted_bytes) AS wasted
    FROM duplicate_groups WHERE brand IS NOT NULL
    GROUP BY brand ORDER BY wasted DESC NULLS LAST LIMIT 10
  `);

  const { rows: byMachine } = await client.query(`
    SELECT f.source_machine,
      COUNT(*)        AS redundant_files,
      SUM(f.size_bytes) AS redundant_bytes
    FROM duplicate_group_members dgm
    JOIN files f ON f.id = dgm.file_id
    JOIN duplicate_groups dg ON dg.id = dgm.group_id
    WHERE f.id != dg.canonical_file_id
    GROUP BY f.source_machine ORDER BY redundant_bytes DESC
  `);

  return { o, byBrand, byMachine };
}

async function runPass1(client) {
  // Insert confirmed duplicate groups (same SHA-256 on multiple machines)
  await client.query(`
    WITH
    dupes AS (
      SELECT sha256, COUNT(*) AS file_count,
        MAX(size_bytes) AS size_bytes,
        (array_agg(brand    ORDER BY brand    NULLS LAST))[1] AS brand,
        (array_agg(category ORDER BY category NULLS LAST))[1] AS category
      FROM files
      WHERE source_machine != 'nas_primary'
      GROUP BY sha256 HAVING COUNT(*) > 1
    ),
    canonical AS (
      SELECT DISTINCT ON (f.sha256) f.id, f.sha256
      FROM files f JOIN dupes d ON d.sha256 = f.sha256
      WHERE f.source_machine != 'nas_primary'
      ORDER BY f.sha256, ${MACHINE_RANK_SQL}, f.indexed_at DESC
    )
    INSERT INTO duplicate_groups
      (sha256, file_count, canonical_file_id, status, wasted_bytes, brand, category)
    SELECT d.sha256, d.file_count, c.id, 'confirmed',
      d.size_bytes * (d.file_count - 1), d.brand, d.category
    FROM dupes d JOIN canonical c ON c.sha256 = d.sha256
    ON CONFLICT (sha256) DO UPDATE SET
      file_count = EXCLUDED.file_count, canonical_file_id = EXCLUDED.canonical_file_id,
      wasted_bytes = EXCLUDED.wasted_bytes, brand = EXCLUDED.brand, category = EXCLUDED.category
  `);

  // Insert all members
  const { rowCount } = await client.query(`
    INSERT INTO duplicate_group_members (group_id, file_id)
    SELECT dg.id, f.id FROM duplicate_groups dg
    JOIN files f ON f.sha256 = dg.sha256
    WHERE dg.status = 'confirmed' AND f.source_machine != 'nas_primary'
    ON CONFLICT DO NOTHING
  `);

  const { rows: [{ groups }] } = await client.query(
    `SELECT COUNT(*) AS groups FROM duplicate_groups WHERE status = 'confirmed'`
  );
  console.log(`[dedupe] Pass 1: ${parseInt(groups)} confirmed groups, ${rowCount} member rows`);
  return parseInt(groups);
}

async function runPass2(client) {
  // Insert probable groups — NAS already has a copy of a local file
  await client.query(`
    WITH nas_matches AS (
      SELECT nas.id AS nas_id, nas.sha256 AS nas_sha256, nas.size_bytes,
        nas.brand, nas.category, COUNT(local.id) AS local_count
      FROM files nas
      JOIN files local ON local.filename = nas.filename
        AND local.size_bytes = nas.size_bytes
        AND local.source_machine != 'nas_primary'
      WHERE nas.source_machine = 'nas_primary'
      GROUP BY nas.id, nas.sha256, nas.size_bytes, nas.brand, nas.category
    )
    INSERT INTO duplicate_groups
      (sha256, file_count, canonical_file_id, status, wasted_bytes, brand, category, nas_copy_id)
    SELECT nas_sha256, local_count + 1, nas_id, 'probable',
      size_bytes * local_count, brand, category, nas_id
    FROM nas_matches
    ON CONFLICT (sha256) DO UPDATE SET
      file_count = EXCLUDED.file_count, canonical_file_id = EXCLUDED.canonical_file_id,
      wasted_bytes = EXCLUDED.wasted_bytes, nas_copy_id = EXCLUDED.nas_copy_id
  `);

  // NAS files as members
  await client.query(`
    INSERT INTO duplicate_group_members (group_id, file_id)
    SELECT dg.id, dg.nas_copy_id FROM duplicate_groups dg
    WHERE dg.status = 'probable' AND dg.nas_copy_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  // Local matching files as members
  await client.query(`
    INSERT INTO duplicate_group_members (group_id, file_id)
    SELECT dg.id, local.id FROM duplicate_groups dg
    JOIN files nas ON nas.id = dg.nas_copy_id
    JOIN files local ON local.filename = nas.filename
      AND local.size_bytes = nas.size_bytes
      AND local.source_machine != 'nas_primary'
    WHERE dg.status = 'probable'
    ON CONFLICT DO NOTHING
  `);

  const { rows: [{ groups }] } = await client.query(
    `SELECT COUNT(*) AS groups FROM duplicate_groups WHERE status = 'probable'`
  );
  console.log(`[dedupe] Pass 2: ${parseInt(groups)} probable NAS-match groups`);
  return parseInt(groups);
}

// ── BullMQ handler ───────────────────────────────────────────────────────────
register("dedupe", async (payload) => {
  const client = await pool.connect();
  try {
    const summaryOnly = payload?.summary === true;
    const clear       = payload?.clear   === true;

    if (summaryOnly) {
      const { o, byBrand, byMachine } = await getSummary(client);
      return {
        total_groups:    parseInt(o.total_groups),
        total_files:     parseInt(o.total_files),
        recoverable_gb:  (Number(o.total_wasted) / 1e9).toFixed(2),
        confirmed:       parseInt(o.confirmed),
        probable:        parseInt(o.probable),
        top_brands:      byBrand.map(r => ({
          brand: r.brand, groups: parseInt(r.groups),
          wasted_mb: Math.round(Number(r.wasted) / 1e6),
        })),
        by_machine: byMachine.map(r => ({
          machine: r.source_machine,
          redundant_files: parseInt(r.redundant_files),
          redundant_gb: (Number(r.redundant_bytes) / 1e9).toFixed(2),
        })),
        cost_usd: 0, model_used: "local-dedupe",
      };
    }

    if (clear) {
      await client.query(`TRUNCATE duplicate_groups RESTART IDENTITY CASCADE`);
      console.log("[dedupe] Cleared previous results");
    }

    const start = Date.now();
    const confirmed = await runPass1(client);
    const probable  = await runPass2(client);

    const { o, byBrand, byMachine } = await getSummary(client);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`[dedupe] ✓ done in ${elapsed}s — ${(Number(o.total_wasted) / 1e9).toFixed(2)} GB recoverable`);

    return {
      elapsed_s:       parseFloat(elapsed),
      confirmed_groups: confirmed,
      probable_groups:  probable,
      total_groups:    parseInt(o.total_groups),
      total_files:     parseInt(o.total_files),
      recoverable_gb:  (Number(o.total_wasted) / 1e9).toFixed(2),
      top_brands:      byBrand.map(r => ({
        brand: r.brand, groups: parseInt(r.groups),
        wasted_mb: Math.round(Number(r.wasted) / 1e6),
      })),
      by_machine: byMachine.map(r => ({
        machine: r.source_machine,
        redundant_files: parseInt(r.redundant_files),
        redundant_gb: (Number(r.redundant_bytes) / 1e9).toFixed(2),
      })),
      cost_usd: 0, model_used: "local-dedupe",
    };

  } finally {
    client.release();
  }
});

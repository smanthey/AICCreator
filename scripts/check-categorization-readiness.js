#!/usr/bin/env node
"use strict";

const pg = require("../infra/postgres");

const REQUIRED_TABLES = [
  "tasks",
  "plans",
  "file_index",
  "index_runs",
  "media_metadata",
  "media_hashes",
  "media_visual_catalog",
  "shoot_groups",
  "shoot_group_members",
];

const REQUIRED_FILE_INDEX_COLUMNS = [
  "id",
  "path",
  "hostname",
  "name",
  "ext",
  "sha256",
  "size_bytes",
  "mtime",
  "mime",
  "category",
  "content_text",
  "semantic_tags",
  "semantic_summary",
  "classified_at",
  "classify_model",
  "brand",
  "category_confidence",
  "category_reason",
  "sub_category",
  "work_needed",
  "review_status",
];

async function getSet(sql, params = []) {
  const { rows } = await pg.query(sql, params);
  return new Set(rows.map((r) => String(Object.values(r)[0])));
}

async function main() {
  console.log("\n=== Categorization Readiness Check ===\n");

  const tableSet = await getSet(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'`
  );

  const missingTables = REQUIRED_TABLES.filter((t) => !tableSet.has(t));

  const colSet = await getSet(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_index'`
  );

  const missingCols = REQUIRED_FILE_INDEX_COLUMNS.filter((c) => !colSet.has(c));

  const { rows: [total] } = await pg.query(`SELECT COUNT(*)::BIGINT AS n FROM file_index`);
  const { rows: [legacyTotal] } = await pg.query(`SELECT COUNT(*)::BIGINT AS n FROM files`).catch(() => ({ rows: [{ n: 0n }] }));
  const { rows: [missingSha] } = await pg.query(`SELECT COUNT(*)::BIGINT AS n FROM file_index WHERE sha256 IS NULL`);
  const { rows: [nullCategory] } = await pg.query(`SELECT COUNT(*)::BIGINT AS n FROM file_index WHERE category IS NULL`);
  const { rows: [lowConfidence] } = await pg.query(
    `SELECT COUNT(*)::BIGINT AS n
       FROM file_index
      WHERE category_confidence IS NOT NULL AND category_confidence < 0.7`
  );

  console.log(`Tables missing     : ${missingTables.length}`);
  if (missingTables.length) console.log(`  - ${missingTables.join("\n  - ")}`);

  console.log(`Columns missing    : ${missingCols.length}`);
  if (missingCols.length) console.log(`  - ${missingCols.join("\n  - ")}`);

  console.log(`Total files        : ${total.n}`);
  console.log(`Legacy files table : ${legacyTotal.n}`);
  console.log(`Missing sha256     : ${missingSha.n}`);
  console.log(`NULL category      : ${nullCategory.n}`);
  console.log(`Low confidence <0.7: ${lowConfidence.n}`);

  let ok = true;

  if (missingTables.length || missingCols.length) {
    ok = false;
    console.log("\nFAIL: DB schema is not ready for categorization.");
  }

  if (Number(total.n) === 0) {
    ok = false;
    console.log("\nFAIL: file_index is empty. Run indexing before categorization.");
    if (Number(legacyTotal.n) > 0) {
      console.log("Hint: legacy data exists in files table. Run:");
      console.log("  node scripts/sync-files-to-file-index.js");
    }
  }

  if (ok) {
    console.log("\nPASS: DB is ready for categorization pipeline.");
  }

  await pg.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`FAIL: ${err.message}`);
  try { await pg.end(); } catch {}
  process.exit(1);
});

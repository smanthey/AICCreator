#!/usr/bin/env node
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const getArg = (f, fallback = null) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : fallback;
};
const hasFlag = (f) => args.includes(f);

const BATCH = Math.max(100, Number(getArg("--batch", "20000")) || 20000);
const MAX_ROWS = Number(getArg("--max-rows", "0")) || 0;
const DRY_RUN = hasFlag("--dry-run");
const REPAIR_ONLY = hasFlag("--repair-only");

const MIME_CASE_SQL = `
CASE src.ext
  WHEN 'jpg' THEN 'image/jpeg'
  WHEN 'jpeg' THEN 'image/jpeg'
  WHEN 'png' THEN 'image/png'
  WHEN 'gif' THEN 'image/gif'
  WHEN 'webp' THEN 'image/webp'
  WHEN 'svg' THEN 'image/svg+xml'
  WHEN 'heic' THEN 'image/heic'
  WHEN 'heif' THEN 'image/heif'
  WHEN 'bmp' THEN 'image/bmp'
  WHEN 'tif' THEN 'image/tiff'
  WHEN 'tiff' THEN 'image/tiff'
  WHEN 'psd' THEN 'image/vnd.adobe.photoshop'
  WHEN 'nef' THEN 'image/x-nikon-nef'
  WHEN 'cr2' THEN 'image/x-canon-cr2'
  WHEN 'cr3' THEN 'image/x-canon-cr3'
  WHEN 'arw' THEN 'image/x-sony-arw'
  WHEN 'dng' THEN 'image/x-adobe-dng'
  WHEN 'orf' THEN 'image/x-olympus-orf'
  WHEN 'rw2' THEN 'image/x-panasonic-rw2'
  WHEN 'mp4' THEN 'video/mp4'
  WHEN 'mov' THEN 'video/quicktime'
  WHEN 'mkv' THEN 'video/x-matroska'
  WHEN 'avi' THEN 'video/x-msvideo'
  WHEN 'webm' THEN 'video/webm'
  WHEN 'm4v' THEN 'video/x-m4v'
  WHEN 'mp3' THEN 'audio/mpeg'
  WHEN 'wav' THEN 'audio/wav'
  WHEN 'aac' THEN 'audio/aac'
  WHEN 'm4a' THEN 'audio/mp4'
  WHEN 'flac' THEN 'audio/flac'
  WHEN 'ogg' THEN 'audio/ogg'
  WHEN 'pdf' THEN 'application/pdf'
  WHEN 'txt' THEN 'text/plain'
  WHEN 'md' THEN 'text/markdown'
  WHEN 'csv' THEN 'text/csv'
  WHEN 'json' THEN 'application/json'
  WHEN 'xml' THEN 'application/xml'
  WHEN 'js' THEN 'application/javascript'
  WHEN 'mjs' THEN 'application/javascript'
  WHEN 'cjs' THEN 'application/javascript'
  WHEN 'ts' THEN 'application/typescript'
  WHEN 'tsx' THEN 'application/typescript'
  WHEN 'jsx' THEN 'text/jsx'
  WHEN 'py' THEN 'text/x-python'
  WHEN 'php' THEN 'application/x-httpd-php'
  WHEN 'lua' THEN 'text/x-lua'
  WHEN 'h' THEN 'text/x-c'
  WHEN 'hpp' THEN 'text/x-c'
  WHEN 'c' THEN 'text/x-c'
  WHEN 'cpp' THEN 'text/x-c++'
  WHEN 'cc' THEN 'text/x-c++'
  WHEN 'm' THEN 'text/x-objective-c'
  WHEN 'mm' THEN 'text/x-objective-c++'
  WHEN 'swift' THEN 'text/x-swift'
  WHEN 'rb' THEN 'text/x-ruby'
  WHEN 'go' THEN 'text/x-go'
  WHEN 'rs' THEN 'text/x-rust'
  WHEN 'java' THEN 'text/x-java-source'
  WHEN 'kt' THEN 'text/x-kotlin'
  WHEN 'kts' THEN 'text/x-kotlin'
  WHEN 'sql' THEN 'application/sql'
  WHEN 'yaml' THEN 'application/yaml'
  WHEN 'yml' THEN 'application/yaml'
  WHEN 'ini' THEN 'text/plain'
  WHEN 'cfg' THEN 'text/plain'
  WHEN 'conf' THEN 'text/plain'
  WHEN 'plist' THEN 'application/x-plist'
  WHEN 'rtf' THEN 'application/rtf'
  WHEN 'doc' THEN 'application/msword'
  WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  WHEN 'xls' THEN 'application/vnd.ms-excel'
  WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  WHEN 'ppt' THEN 'application/vnd.ms-powerpoint'
  WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  WHEN 'zip' THEN 'application/zip'
  WHEN 'rar' THEN 'application/vnd.rar'
  WHEN '7z' THEN 'application/x-7z-compressed'
  ELSE NULL
END
`;

async function main() {
  console.log("\n=== Sync files -> file_index ===\n");
  console.log(`Batch size : ${BATCH}`);
  if (MAX_ROWS > 0) console.log(`Max rows   : ${MAX_ROWS}`);
  if (DRY_RUN) console.log("Mode       : DRY RUN");
  if (REPAIR_ONLY) console.log("Mode       : REPAIR ONLY");

  const rel = await pg.query(`
    SELECT to_regclass('public.files') AS files_rel
  `);
  const hasFilesTable = Boolean(rel.rows[0]?.files_rel);

  const counts = hasFilesTable
    ? await pg.query(`
        SELECT
          (SELECT COUNT(*)::bigint FROM files) AS files_count,
          (SELECT COUNT(*)::bigint FROM file_index) AS file_index_count
      `)
    : await pg.query(`
        SELECT
          0::bigint AS files_count,
          (SELECT COUNT(*)::bigint FROM file_index) AS file_index_count
      `);

  const filesCount = Number(counts.rows[0].files_count || 0);
  const fileIndexCount = Number(counts.rows[0].file_index_count || 0);
  console.log(`files      : ${filesCount}`);
  console.log(`file_index : ${fileIndexCount}`);

  if (!hasFilesTable) {
    console.log("\nSource table 'files' is missing in this database. Skipping sync.");
    await pg.end();
    return;
  }

  if (filesCount === 0) {
    console.log("\nNo source rows in files. Nothing to sync.");
    await pg.end();
    return;
  }

  let lastId = 0;
  let scanned = 0;
  let upserted = 0;
  let loops = 0;

  if (!REPAIR_ONLY) {
    while (true) {
      if (MAX_ROWS > 0 && scanned >= MAX_ROWS) break;
      const currentBatch = MAX_ROWS > 0 ? Math.min(BATCH, MAX_ROWS - scanned) : BATCH;
      if (currentBatch <= 0) break;

    const sql = DRY_RUN
      ? `
        WITH src AS (
          SELECT
            f.id,
            f.path,
            f.filename,
            f.source_machine,
            f.sha256,
            f.size_bytes,
            f.modified_at,
            f.indexed_at,
            f.category,
            f.category_confidence,
            f.category_reason,
            f.brand,
            f.sub_category,
            f.work_needed,
            f.review_status,
            LOWER(NULLIF(REGEXP_REPLACE(f.filename, '^.*\\.', ''), f.filename)) AS ext
          FROM files f
          WHERE f.id > $1
          ORDER BY f.id ASC
          LIMIT $2
        )
        SELECT
          COUNT(*)::int AS picked,
          COALESCE(MAX(id), $1)::bigint AS max_id
        FROM src
      `
      : `
        WITH src AS (
          SELECT
            f.id,
            f.path,
            f.filename,
            f.source_machine,
            f.sha256,
            f.size_bytes,
            f.modified_at,
            f.indexed_at,
            f.category,
            f.category_confidence,
            f.category_reason,
            f.brand,
            f.sub_category,
            f.work_needed,
            f.review_status,
            LOWER(NULLIF(REGEXP_REPLACE(f.filename, '^.*\\.', ''), f.filename)) AS ext
          FROM files f
          WHERE f.id > $1
          ORDER BY f.id ASC
          LIMIT $2
        ),
        ins AS (
          INSERT INTO file_index (
            path, hostname, name, ext, sha256, size_bytes, mtime, mime, category,
            source_machine, indexed_at, category_confidence, category_reason,
            brand, sub_category, work_needed, review_status
          )
          SELECT
            CASE WHEN RIGHT(src.path, 1) = '/'
                 THEN src.path || src.filename
                 ELSE src.path || '/' || src.filename
            END AS full_path,
            src.source_machine AS hostname,
            src.filename AS name,
            src.ext,
            src.sha256,
            src.size_bytes,
            src.modified_at::timestamptz AS mtime,
            ${MIME_CASE_SQL} AS mime,
            src.category,
            src.source_machine,
            src.indexed_at::timestamptz,
            src.category_confidence::numeric,
            src.category_reason,
            src.brand,
            src.sub_category,
            src.work_needed,
            src.review_status
          FROM src
          ON CONFLICT (path, hostname) DO UPDATE SET
            name = EXCLUDED.name,
            ext = EXCLUDED.ext,
            sha256 = EXCLUDED.sha256,
            size_bytes = EXCLUDED.size_bytes,
            mtime = EXCLUDED.mtime,
            mime = COALESCE(file_index.mime, EXCLUDED.mime),
            category = COALESCE(EXCLUDED.category, file_index.category),
            source_machine = COALESCE(EXCLUDED.source_machine, file_index.source_machine),
            indexed_at = GREATEST(COALESCE(file_index.indexed_at, EXCLUDED.indexed_at), EXCLUDED.indexed_at),
            category_confidence = COALESCE(EXCLUDED.category_confidence, file_index.category_confidence),
            category_reason = COALESCE(EXCLUDED.category_reason, file_index.category_reason),
            brand = COALESCE(EXCLUDED.brand, file_index.brand),
            sub_category = COALESCE(EXCLUDED.sub_category, file_index.sub_category),
            work_needed = COALESCE(EXCLUDED.work_needed, file_index.work_needed),
            review_status = COALESCE(EXCLUDED.review_status, file_index.review_status)
          RETURNING 1
        )
        SELECT
          (SELECT COUNT(*)::int FROM src) AS picked,
          (SELECT COUNT(*)::int FROM ins) AS wrote,
          COALESCE((SELECT MAX(id) FROM src), $1)::bigint AS max_id
      `;

      const { rows } = await pg.query(sql, [lastId, currentBatch]);
      const row = rows[0] || {};
      const picked = Number(row.picked || 0);
      const wrote = Number(row.wrote || 0);
      const maxId = Number(row.max_id || lastId);

      if (picked === 0) break;

      scanned += picked;
      upserted += wrote;
      loops += 1;
      lastId = maxId;

      if (loops % 5 === 0 || picked < currentBatch) {
        console.log(`... scanned=${scanned} wrote=${upserted} last_id=${lastId}`);
      }

      if (picked < currentBatch) break;
    }
  }

  if (!DRY_RUN) {
    const repair = await pg.query(`
      WITH patched AS (
        UPDATE file_index fi
        SET mime = mapped.mime
        FROM (
          SELECT
            id,
            CASE ext
              WHEN 'jpg' THEN 'image/jpeg'
              WHEN 'jpeg' THEN 'image/jpeg'
              WHEN 'png' THEN 'image/png'
              WHEN 'gif' THEN 'image/gif'
              WHEN 'webp' THEN 'image/webp'
              WHEN 'svg' THEN 'image/svg+xml'
              WHEN 'heic' THEN 'image/heic'
              WHEN 'heif' THEN 'image/heif'
              WHEN 'bmp' THEN 'image/bmp'
              WHEN 'tif' THEN 'image/tiff'
              WHEN 'tiff' THEN 'image/tiff'
              WHEN 'psd' THEN 'image/vnd.adobe.photoshop'
              WHEN 'nef' THEN 'image/x-nikon-nef'
              WHEN 'cr2' THEN 'image/x-canon-cr2'
              WHEN 'cr3' THEN 'image/x-canon-cr3'
              WHEN 'arw' THEN 'image/x-sony-arw'
              WHEN 'dng' THEN 'image/x-adobe-dng'
              WHEN 'orf' THEN 'image/x-olympus-orf'
              WHEN 'rw2' THEN 'image/x-panasonic-rw2'
              WHEN 'mp4' THEN 'video/mp4'
              WHEN 'mov' THEN 'video/quicktime'
              WHEN 'mkv' THEN 'video/x-matroska'
              WHEN 'avi' THEN 'video/x-msvideo'
              WHEN 'webm' THEN 'video/webm'
              WHEN 'm4v' THEN 'video/x-m4v'
              WHEN 'mp3' THEN 'audio/mpeg'
              WHEN 'wav' THEN 'audio/wav'
              WHEN 'aac' THEN 'audio/aac'
              WHEN 'm4a' THEN 'audio/mp4'
              WHEN 'flac' THEN 'audio/flac'
              WHEN 'ogg' THEN 'audio/ogg'
              WHEN 'pdf' THEN 'application/pdf'
              WHEN 'txt' THEN 'text/plain'
              WHEN 'md' THEN 'text/markdown'
              WHEN 'csv' THEN 'text/csv'
              WHEN 'json' THEN 'application/json'
              WHEN 'xml' THEN 'application/xml'
              WHEN 'js' THEN 'application/javascript'
              WHEN 'mjs' THEN 'application/javascript'
              WHEN 'cjs' THEN 'application/javascript'
              WHEN 'ts' THEN 'application/typescript'
              WHEN 'tsx' THEN 'application/typescript'
              WHEN 'jsx' THEN 'text/jsx'
              WHEN 'py' THEN 'text/x-python'
              WHEN 'php' THEN 'application/x-httpd-php'
              WHEN 'lua' THEN 'text/x-lua'
              WHEN 'h' THEN 'text/x-c'
              WHEN 'hpp' THEN 'text/x-c'
              WHEN 'c' THEN 'text/x-c'
              WHEN 'cpp' THEN 'text/x-c++'
              WHEN 'cc' THEN 'text/x-c++'
              WHEN 'm' THEN 'text/x-objective-c'
              WHEN 'mm' THEN 'text/x-objective-c++'
              WHEN 'swift' THEN 'text/x-swift'
              WHEN 'rb' THEN 'text/x-ruby'
              WHEN 'go' THEN 'text/x-go'
              WHEN 'rs' THEN 'text/x-rust'
              WHEN 'java' THEN 'text/x-java-source'
              WHEN 'kt' THEN 'text/x-kotlin'
              WHEN 'kts' THEN 'text/x-kotlin'
              WHEN 'sql' THEN 'application/sql'
              WHEN 'yaml' THEN 'application/yaml'
              WHEN 'yml' THEN 'application/yaml'
              WHEN 'ini' THEN 'text/plain'
              WHEN 'cfg' THEN 'text/plain'
              WHEN 'conf' THEN 'text/plain'
              WHEN 'plist' THEN 'application/x-plist'
              WHEN 'rtf' THEN 'application/rtf'
              WHEN 'doc' THEN 'application/msword'
              WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              WHEN 'xls' THEN 'application/vnd.ms-excel'
              WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              WHEN 'ppt' THEN 'application/vnd.ms-powerpoint'
              WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              WHEN 'zip' THEN 'application/zip'
              WHEN 'rar' THEN 'application/vnd.rar'
              WHEN '7z' THEN 'application/x-7z-compressed'
              ELSE NULL
            END AS mime
          FROM file_index
          WHERE mime IS NULL AND ext IS NOT NULL
        ) mapped
        WHERE fi.id = mapped.id
          AND mapped.mime IS NOT NULL
        RETURNING 1
      )
      SELECT COUNT(*)::int AS updated FROM patched
    `);
    console.log(`MIME repairs updated: ${repair.rows[0]?.updated || 0}`);
  }

  console.log("\nDone.");
  console.log(`Scanned : ${scanned}`);
  console.log(`Wrote   : ${upserted}${DRY_RUN ? " (dry-run expected 0 writes)" : ""}`);

  const post = await pg.query(`SELECT COUNT(*)::bigint AS n FROM file_index`);
  console.log(`file_index now: ${post.rows[0].n}`);

  await pg.end();
}

main().catch(async (err) => {
  console.error("FAIL:", err.message);
  try { await pg.end(); } catch {}
  process.exit(1);
});

// agents/index-agent.js
// Persistent filesystem indexer with incremental delta support.
//
// What changed from the stub:
//   • SHA-256 hashes every file — detects renames / duplicates across machines
//   • Upserts into file_index (path, hostname) — safe to re-run at any time
//   • Skips files whose mtime + size haven't changed (fast incremental pass)
//   • Logs each run to index_runs for audit + progress tracking
//   • Extracts plain text from .txt / .md / .csv / .json / .js / .ts / .py
//     (capped at 50 KB) so full-text search works immediately after indexing
//
// Payload:
//   { path: "~/Documents/projects" }   — index a directory (recursive)
//   { path: "/abs/path", force: true } — re-hash everything even if mtime matches
//
// Queue: claw_tasks_io (io_light worker)

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const os     = require("os");
const { register } = require("./registry");
require("dotenv").config();
const pg = require("../infra/postgres");

// ── Extension → (mime, category) ─────────────────────────────────────────────
const EXT_MAP = {
  jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",
  webp:"image/webp",heic:"image/heic",heif:"image/heif",tiff:"image/tiff",
  bmp:"image/bmp",svg:"image/svg+xml",raw:"image/x-raw",
  cr2:"image/x-canon-cr2",nef:"image/x-nikon-nef",arw:"image/x-sony-arw",
  mp4:"video/mp4",mov:"video/quicktime",avi:"video/x-msvideo",
  mkv:"video/x-matroska",wmv:"video/x-ms-wmv",m4v:"video/x-m4v",
  mp3:"audio/mpeg",aac:"audio/aac",wav:"audio/wav",flac:"audio/flac",
  m4a:"audio/mp4",ogg:"audio/ogg",
  pdf:"application/pdf",doc:"application/msword",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt:"application/vnd.ms-powerpoint",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pages:"application/x-iwork-pages-sffpages",
  numbers:"application/x-iwork-numbers-sffnumbers",
  keynote:"application/x-iwork-keynote-sffkey",
  txt:"text/plain",md:"text/markdown",csv:"text/csv",
  json:"application/json",xml:"application/xml",
  js:"text/javascript",ts:"text/typescript",py:"text/x-python",
  sh:"text/x-shellscript",rb:"text/x-ruby",go:"text/x-go",
  rs:"text/x-rust",java:"text/x-java",swift:"text/x-swift",
  zip:"application/zip",tar:"application/x-tar",gz:"application/gzip",
  "7z":"application/x-7z-compressed",rar:"application/vnd.rar",
  dmg:"application/x-apple-diskimage",
};

const CATEGORY_MAP = {
  "image/":"image","video/":"video","audio/":"audio",
  "application/pdf":"document","application/msword":"document",
  "application/vnd.openxmlformats":"document","application/vnd.ms-":"document",
  "application/x-iwork":"document",
  "text/plain":"text","text/markdown":"text","text/csv":"data",
  "application/json":"data","application/xml":"data",
  "text/javascript":"code","text/typescript":"code","text/x-python":"code",
  "text/x-shellscript":"code","text/x-ruby":"code","text/x-go":"code",
  "text/x-rust":"code","text/x-java":"code","text/x-swift":"code",
  "application/zip":"archive","application/x-tar":"archive",
  "application/gzip":"archive","application/x-7z":"archive",
  "application/vnd.rar":"archive","application/x-apple-diskimage":"archive",
};

// Text-extractable extensions (capped at 50 KB)
const TEXT_EXTS = new Set([
  "txt","md","csv","json","xml","js","ts","py","sh","rb","go","rs",
  "java","swift","html","htm","css","yaml","yml","toml","ini","conf","log",
]);
const TEXT_CAP_BYTES = 50 * 1024;

function getMime(ext) { return EXT_MAP[ext] || "application/octet-stream"; }

function getCategory(mime) {
  for (const [prefix, cat] of Object.entries(CATEGORY_MAP)) {
    if (mime.startsWith(prefix)) return cat;
  }
  return "unknown";
}

function resolveHome(p) {
  if (!p) return null;
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function sha256file(filePath) {
  const hash = crypto.createHash("sha256");
  const buf  = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest("hex");
}

function extractText(filePath, ext) {
  if (!TEXT_EXTS.has(ext)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > TEXT_CAP_BYTES * 4) return null; // skip huge files
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.slice(0, TEXT_CAP_BYTES);
  } catch { return null; }
}

function walkDir(dir, filePaths = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return filePaths; } // permission denied — skip
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name.startsWith(".")) continue; // skip hidden
    if (e.isDirectory()) walkDir(full, filePaths);
    else if (e.isFile()) filePaths.push(full);
  }
  return filePaths;
}

register("index", async (payload) => {
  const rootRaw  = payload?.path || payload;
  const force    = payload?.force === true;
  const rootPath = resolveHome(String(rootRaw));
  if (!rootPath) throw new Error("index payload must include { path }");
  if (!fs.existsSync(rootPath)) throw new Error(`Path not found: ${rootPath}`);

  const hostname = os.hostname();

  // Open index_run
  const { rows: [run] } = await pg.query(
    `INSERT INTO index_runs (hostname, root_path, plan_id, task_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [hostname, rootPath, payload?.plan_id || null, payload?.task_id || null]
  );
  const runId = run.id;

  const allFiles = walkDir(rootPath);
  let filesNew = 0, filesUpdated = 0, filesSkipped = 0;

  for (const filePath of allFiles) {
    try {
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }

      const ext      = path.extname(filePath).toLowerCase().replace(".", "");
      const mime     = getMime(ext);
      const category = getCategory(mime);
      const mtime    = stat.mtime;
      const sizeBytes = stat.size;

      // ── Incremental check ───────────────────────────────────────
      if (!force) {
        const { rows } = await pg.query(
          `SELECT id, size_bytes, mtime FROM file_index
           WHERE path = $1 AND hostname = $2`,
          [filePath, hostname]
        );
        if (rows.length > 0) {
          const existing = rows[0];
          const mtimeMatch = existing.mtime &&
            Math.abs(new Date(existing.mtime) - mtime) < 1000;
          if (mtimeMatch && existing.size_bytes === sizeBytes) {
            filesSkipped++;
            continue; // unchanged — skip expensive hash + extraction
          }
        }
      }

      const sha256      = sha256file(filePath);
      const contentText = extractText(filePath, ext);

      await pg.query(
        `INSERT INTO file_index
           (path, hostname, name, ext, sha256, size_bytes, mtime,
            mime, category, content_text, indexed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (path, hostname) DO UPDATE SET
           name         = EXCLUDED.name,
           ext          = EXCLUDED.ext,
           sha256       = EXCLUDED.sha256,
           size_bytes   = EXCLUDED.size_bytes,
           mtime        = EXCLUDED.mtime,
           mime         = EXCLUDED.mime,
           category     = EXCLUDED.category,
           content_text = EXCLUDED.content_text,
           indexed_at   = NOW(),
           -- reset semantic fields so classify-agent re-runs on changed files
           classified_at  = CASE WHEN file_index.sha256 != EXCLUDED.sha256
                                 THEN NULL ELSE file_index.classified_at END,
           semantic_tags    = CASE WHEN file_index.sha256 != EXCLUDED.sha256
                                   THEN NULL ELSE file_index.semantic_tags END,
           semantic_summary = CASE WHEN file_index.sha256 != EXCLUDED.sha256
                                   THEN NULL ELSE file_index.semantic_summary END`,
        [filePath, hostname, path.basename(filePath), ext || null,
         sha256, sizeBytes, mtime, mime, category, contentText]
      );

      // Determine if new or updated
      const { rows: existing2 } = await pg.query(
        `SELECT indexed_at FROM file_index WHERE path=$1 AND hostname=$2`,
        [filePath, hostname]
      );
      // If indexed_at is very recent it was just inserted (new) vs updated
      if (existing2.length > 0) {
        const age = Date.now() - new Date(existing2[0].indexed_at).getTime();
        if (age < 2000) filesNew++;
        else filesUpdated++;
      }

    } catch (err) {
      console.warn(`[index] skip ${filePath}: ${err.message}`);
    }
  }

  // Close index_run
  await pg.query(
    `UPDATE index_runs SET
       finished_at   = NOW(),
       files_scanned = $1,
       files_new     = $2,
       files_updated = $3,
       files_skipped = $4
     WHERE id = $5`,
    [allFiles.length, filesNew, filesUpdated, filesSkipped, runId]
  );

  console.log(
    `[index] ✓ ${rootPath} | ` +
    `scanned=${allFiles.length} new=${filesNew} updated=${filesUpdated} skipped=${filesSkipped}`
  );

  return {
    indexed_path:  rootPath,
    file_count:    allFiles.length,
    files_new:     filesNew,
    files_updated: filesUpdated,
    files_skipped: filesSkipped,
    run_id:        runId,
    cost_usd:      0,
    model_used:    "local-indexer",
  };
});

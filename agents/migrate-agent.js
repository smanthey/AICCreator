// agents/migrate-agent.js
// Copies files to ClawVault with SHA-256 verification.
// Writes a vault_files record per file for dedup + audit trail.
//
// Payload options:
//   { files: ["/src/a.jpg", "/src/b.pdf"], dest_dir: "/vault/Photos" }
//   { source_dir: "/src/2023", dest_dir: "/vault/2023", filter_category: "image" }
//   { dedupe_task_id: "<uuid>" }  — use output of a prior dedupe task
//
// Env: NAS_VAULT_PATH  — root of ClawVault mount (e.g. /Volumes/ClawVault)

const fs     = require("fs");
const fsp    = require("fs").promises;
const path   = require("path");
const crypto = require("crypto");
const pg     = require("../infra/postgres");
const { register } = require("./registry");

function resolveHome(p) {
  if (!p) return null;
  if (p.startsWith("~/")) return path.join(process.env.HOME, p.slice(2));
  return p;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end",  ()    => resolve(hash.digest("hex")));
    stream.on("error", err  => reject(err));
  });
}

function walkDir(dir, filePaths = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, filePaths);
    else if (e.isFile()) filePaths.push(full);
  }
  return filePaths;
}

// Basic MIME/category from extension (mirrors classify-agent)
const CATEGORY_MAP = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", heic: "image",
  heif: "image", tiff: "image", bmp: "image", webp: "image", raw: "image",
  cr2: "image", nef: "image", arw: "image",
  mp4: "video", mov: "video", avi: "video", mkv: "video", m4v: "video",
  mp3: "audio", aac: "audio", wav: "audio", flac: "audio", m4a: "audio",
  pdf: "document", doc: "document", docx: "document",
  xls: "document", xlsx: "document", ppt: "document", pptx: "document",
  txt: "text", md: "text",
  csv: "data", json: "data",
  zip: "archive", tar: "archive", gz: "archive",
};

register("migrate", async (payload) => {
  // ── Resolve NAS vault root ─────────────────────────────────
  const vaultRoot = resolveHome(
    process.env.NAS_VAULT_PATH || "/Volumes/ClawVault"
  );

  if (!fs.existsSync(vaultRoot)) {
    throw new Error(
      `NAS vault not accessible at ${vaultRoot}. ` +
      `Set NAS_VAULT_PATH in .env and ensure the share is mounted.`
    );
  }

  // ── Resolve file list ───────────────────────────────────────
  let filePaths = [];
  let destDir;

  if (payload?.dedupe_task_id) {
    // Pull file list from a completed dedupe task's result
    const { rows } = await pg.query(
      `SELECT result FROM tasks WHERE id = $1 AND status = 'COMPLETED'`,
      [payload.dedupe_task_id]
    );
    if (!rows.length) throw new Error(`Dedupe task ${payload.dedupe_task_id} not found or not completed`);
    const dedupeResult = rows[0].result;
    // Migrate canonical files (not duplicates — those should be deleted separately)
    for (const group of dedupeResult.groups || []) {
      if (group.canonical) filePaths.push(group.canonical);
    }
    destDir = resolveHome(payload.dest_dir || `${vaultRoot}/Migrated`);
  } else if (payload?.source_dir || payload?.source_path) {
    const sourceDir = resolveHome(payload.source_dir || payload.source_path);
    if (!fs.existsSync(sourceDir)) throw new Error(`Source dir not found: ${sourceDir}`);
    filePaths = walkDir(sourceDir);
    destDir   = resolveHome(payload.dest_dir || `${vaultRoot}/Migrated`);
  } else if (payload?.files && Array.isArray(payload.files)) {
    filePaths = payload.files.map(resolveHome);
    destDir   = resolveHome(payload.dest_dir);
    if (!destDir) throw new Error("migrate payload with { files } must include dest_dir");
  } else {
    throw new Error("migrate payload must include { source_dir }, { files }, or { dedupe_task_id }");
  }

  // Ensure dest exists
  await fsp.mkdir(destDir, { recursive: true });

  const results = { migrated: 0, skipped_existing: 0, failed: 0, errors: [] };
  let totalBytes = 0;

  console.log(`[migrate] ${filePaths.length} files → ${destDir}`);

  for (const src of filePaths) {
    const filename = path.basename(src);
    const ext      = path.extname(filename).toLowerCase().replace(".", "");
    const dest     = path.join(destDir, filename);

    try {
      // ── Hash source ───────────────────────────────────────
      const srcHash = await sha256File(src);
      const stat    = fs.statSync(src);

      // ── Check vault_files for existing entry by hash ──────
      // NAS schema uses sha256 as unique key (idx_vault_sha256)
      const { rows: existing } = await pg.query(
        `SELECT id, canonical_path FROM vault_files WHERE sha256 = $1 LIMIT 1`,
        [srcHash]
      );

      if (existing.length > 0) {
        console.log(`[migrate] ⊘ skip (already in vault): ${filename}`);
        results.skipped_existing++;
        continue;
      }

      // ── Copy file (never overwrite — suffix if collision) ──
      let finalDest = dest;
      if (fs.existsSync(dest)) {
        const base  = path.basename(filename, ext ? `.${ext}` : "");
        const stamp = Date.now();
        finalDest   = path.join(destDir, `${base}_${stamp}${ext ? `.${ext}` : ""}`);
      }

      await fsp.copyFile(src, finalDest);

      // ── Verify copy integrity ─────────────────────────────
      const destHash = await sha256File(finalDest);
      if (destHash !== srcHash) {
        await fsp.unlink(finalDest).catch(() => {});
        throw new Error(`Hash mismatch after copy! src=${srcHash} dest=${destHash}`);
      }

      // ── Write vault_files record (using NAS column names) ─
      await pg.query(
        `INSERT INTO vault_files
           (source_path, canonical_path, filename, ext, mime, category,
            size_bytes, sha256, verified_at, plan_id, task_id,
            source_machine)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)
         ON CONFLICT (sha256) DO NOTHING`,
        [
          src,
          finalDest,
          filename,
          ext,
          `${CATEGORY_MAP[ext] || "application"}/octet-stream`,
          CATEGORY_MAP[ext] || "unknown",
          stat.size,
          srcHash,
          payload?.plan_id      || null,
          payload?.task_id      || null,
          process.env.HOSTNAME  || require("os").hostname(),
        ]
      );

      totalBytes += stat.size;
      results.migrated++;
      console.log(`[migrate] ✓ ${filename} (${(stat.size / 1024).toFixed(0)} KB)`);

    } catch (err) {
      results.failed++;
      results.errors.push({ path: src, error: err.message });
      console.error(`[migrate] ✗ ${filename}: ${err.message}`);
    }
  }

  const summary =
    `migrated=${results.migrated} ` +
    `skipped=${results.skipped_existing} ` +
    `failed=${results.failed} ` +
    `total=${(totalBytes / 1024 / 1024).toFixed(1)}MB`;

  console.log(`[migrate] Done — ${summary}`);

  return {
    ...results,
    total_bytes:  totalBytes,
    total_mb:     Math.round(totalBytes / 1024 / 1024),
    dest_dir:     destDir,
    cost_usd:     0,
    model_used:   "local-migrate",
  };
});

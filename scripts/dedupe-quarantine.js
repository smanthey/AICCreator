#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Pool } = require("pg");

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const INCLUDE_PROBABLE = args.includes("--include-probable");
const INCLUDE_DESKTOP = args.includes("--include-desktop");
const HELP = args.includes("--help") || args.includes("-h");
const FORCE_WITHOUT_BACKUP = args.includes("--force-without-backup");

function getArg(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function getMultiArg(name) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && i + 1 < args.length) out.push(args[i + 1]);
  }
  return out;
}

const LIMIT = Number(getArg("--limit", "2000"));
const MIN_MB = Number(getArg("--min-size-mb", "5"));
const MAX_BYTES = Number(getArg("--max-bytes-gb", "25")) * 1024 * 1024 * 1024;

const defaultQuarantineRoot = path.join(
  os.homedir(),
  "claw-quarantine",
  "dedupe",
  new Date().toISOString().replace(/[:.]/g, "-")
);
const QUARANTINE_ROOT = getArg("--quarantine-root", defaultQuarantineRoot);
const REQUIRE_BACKUP_VERIFY = String(process.env.DEDUPE_REQUIRE_BACKUP_VERIFY || "true").toLowerCase() === "true";

const SAFE_PREFIXES = [path.join(os.homedir(), "Downloads")];
if (INCLUDE_DESKTOP) SAFE_PREFIXES.push(path.join(os.homedir(), "Desktop"));
for (const p of getMultiArg("--safe-prefix")) {
  SAFE_PREFIXES.push(path.resolve(String(p)));
}

const SAFE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "svg",
  "mp4", "mov", "m4v", "mkv", "avi",
  "pdf", "zip", "rar", "7z", "tar", "gz", "dmg",
  "mp3", "wav", "aac", "m4a", "flac",
  "txt", "csv", "json", "md",
]);

function usage() {
  console.log(`
Usage:
  node scripts/dedupe-quarantine.js                 # report only
  node scripts/dedupe-quarantine.js --execute       # move to quarantine

Options:
  --limit <n>                 Max candidate rows to evaluate (default: ${LIMIT})
  --min-size-mb <n>           Minimum file size in MB (default: ${MIN_MB})
  --max-bytes-gb <n>          Move cap in GB per run (default: ${MAX_BYTES / (1024 * 1024 * 1024)})
  --include-probable          Include probable (name+size) groups (default: confirmed only)
  --include-desktop           Include Desktop in safe source paths (default: Downloads only)
  --safe-prefix <path>        Additional allowed source prefix (repeatable)
  --quarantine-root <path>    Destination root (default: ${QUARANTINE_ROOT})
  --force-without-backup      Bypass backup verification gate (not recommended)
`.trim());
}

function latestBackupVerifyReport() {
  const dir = path.join(process.cwd(), "scripts", "reports");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith("-backup-verify-nas.json")).sort();
  if (!files.length) return null;
  const full = path.join(dir, files[files.length - 1]);
  try {
    const json = JSON.parse(fs.readFileSync(full, "utf8"));
    return { path: full, data: json };
  } catch {
    return null;
  }
}

function formatBytes(n) {
  const x = Number(n || 0);
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)} GB`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)} MB`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)} KB`;
  return `${x} B`;
}

function isSafePath(fullPath) {
  return SAFE_PREFIXES.some((p) => fullPath.startsWith(p + path.sep) || fullPath === p);
}

function isSafeExt(filename) {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  return SAFE_EXTS.has(ext);
}

function toFullPath(dir, file) {
  return path.join(dir || "", file || "");
}

function toQuarantinePath(srcPath) {
  const rel = srcPath.replace(/^\/+/, "");
  return path.join(QUARANTINE_ROOT, rel);
}

function dedupeByPath(rows) {
  const m = new Map();
  for (const r of rows) {
    const p = toFullPath(r.path, r.filename);
    if (!m.has(p)) m.set(p, r);
  }
  return [...m.values()];
}

function ensureDestPath(dest) {
  if (!fs.existsSync(dest)) return dest;
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  let i = 1;
  let candidate = dest;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}.dupe-${i}${ext}`);
    i += 1;
  }
  return candidate;
}

async function main() {
  if (HELP) {
    usage();
    return;
  }

  const pool = new Pool({
    host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
    port: Number(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || 15432),
    user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
    password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.CLAW_DB_NAME || "claw",
    max: 2,
  });

  const statuses = INCLUDE_PROBABLE ? ["confirmed", "probable"] : ["confirmed"];

  const sql = `
    SELECT
      f.id,
      f.source_machine,
      f.path,
      f.filename,
      f.size_bytes,
      dg.status,
      dg.id AS group_id,
      dg.canonical_file_id
    FROM duplicate_group_members dgm
    JOIN duplicate_groups dg ON dg.id = dgm.group_id
    JOIN files f ON f.id = dgm.file_id
    WHERE f.id != dg.canonical_file_id
      AND f.source_machine != 'nas_primary'
      AND dg.status = ANY($1::text[])
      AND f.size_bytes >= $2
    ORDER BY f.size_bytes DESC
    LIMIT $3
  `;

  const minBytes = Math.max(1, Math.floor(MIN_MB * 1024 * 1024));
  const preflight = await pool.query(
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

  const { rows } = await pool.query(sql, [statuses, minBytes, LIMIT]);

  let candidates = dedupeByPath(rows)
    .map((r) => ({ ...r, fullPath: toFullPath(r.path, r.filename) }))
    .filter((r) => isSafePath(r.fullPath))
    .filter((r) => isSafeExt(r.filename))
    .filter((r) => fs.existsSync(r.fullPath))
    .filter((r) => fs.statSync(r.fullPath).isFile());

  let selected = [];
  let bytesSelected = 0;
  for (const c of candidates) {
    if (bytesSelected + Number(c.size_bytes || 0) > MAX_BYTES) continue;
    selected.push(c);
    bytesSelected += Number(c.size_bytes || 0);
  }

  console.log("\n=== Dedupe Quarantine ===");
  console.log(`mode                 : ${EXECUTE ? "EXECUTE (move)" : "REPORT (no move)"}`);
  console.log(`statuses             : ${statuses.join(", ")}`);
  console.log(`safe prefixes        : ${SAFE_PREFIXES.join(", ")}`);
  console.log(`safe extensions      : ${SAFE_EXTS.size} types`);
  console.log(`quarantine root      : ${QUARANTINE_ROOT}`);
  console.log(`db rows scanned      : ${rows.length}`);
  console.log(`candidate files      : ${candidates.length}`);
  console.log(`selected files       : ${selected.length}`);
  console.log(`selected bytes       : ${formatBytes(bytesSelected)}`);

  const preview = selected.slice(0, 20);
  if (preview.length) {
    console.log("\nTop selected files:");
    for (const p of preview) {
      console.log(`  - ${formatBytes(p.size_bytes)} | ${p.fullPath}`);
    }
  }

  if (!EXECUTE) {
    console.log("\nNo files moved (report mode). Use --execute to move selected files to quarantine.");
    await pool.end();
    return;
  }

  if (EXECUTE && REQUIRE_BACKUP_VERIFY && !FORCE_WITHOUT_BACKUP) {
    const latest = latestBackupVerifyReport();
    const ok = !!(latest && latest.data && latest.data.ok === true && latest.data.coverage_ok === true);
    if (!ok) {
      const detail = latest ? `latest=${latest.path}` : "no backup verify report found";
      throw new Error(
        `Backup verification gate failed (${detail}). ` +
        `Run backup:to:nas on all devices + backup:verify:nas before dedupe execute, or pass --force-without-backup to override.`
      );
    }
    console.log(`\nBackup verification gate passed: ${latest.path}`);
  }

  fs.mkdirSync(QUARANTINE_ROOT, { recursive: true });
  const logPath = path.join(QUARANTINE_ROOT, "move-log.jsonl");

  let moved = 0;
  let failed = 0;
  let movedBytes = 0;
  for (const s of selected) {
    const src = s.fullPath;
    let dest = toQuarantinePath(src);
    dest = ensureDestPath(dest);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(),
        phase: "move_start",
        src,
        dest,
      }) + "\n");
      fs.renameSync(src, dest);
      await pool.query(
        `UPDATE files
           SET path = $1,
               filename = $2,
               indexed_at = NOW()
         WHERE id = $3`,
        [path.dirname(dest), path.basename(dest), s.id]
      );
      moved += 1;
      movedBytes += Number(s.size_bytes || 0);
      fs.appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(),
        status: s.status,
        group_id: s.group_id,
        source_machine: s.source_machine,
        size_bytes: Number(s.size_bytes || 0),
        src,
        dest,
      }) + "\n");
    } catch (e) {
      failed += 1;
      fs.appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(),
        error: e.message,
        src,
        dest,
      }) + "\n");
    }
  }

  console.log("\nMove result:");
  console.log(`  moved              : ${moved}`);
  console.log(`  failed             : ${failed}`);
  console.log(`  moved bytes        : ${formatBytes(movedBytes)}`);
  console.log(`  log                : ${logPath}`);
  await pool.end();
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f, fallback = "") => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const DRY_RUN = hasFlag("--dry-run");
const VERIFY_ONLY = hasFlag("--verify-only");
const MAX_FILES = Math.max(1, Number(getArg("--max-files", process.env.BACKUP_MAX_FILES || "5000")) || 5000);
const MIN_FILE_BYTES = Math.max(0, Number(getArg("--min-file-bytes", process.env.BACKUP_MIN_FILE_BYTES || "1")) || 1);

const DEVICE = String(getArg("--device", process.env.BACKUP_DEVICE_NAME || os.hostname())).trim();
const NAS_BACKUP_ROOT = path.resolve(String(getArg("--nas-root", process.env.NAS_BACKUP_ROOT || "/Volumes/home/Storage/_claw_backup")).trim());
const SOURCE_ROOTS = String(getArg("--roots", process.env.BACKUP_SOURCE_ROOTS || "")).split("|").map((s) => s.trim()).filter(Boolean);

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".cache", ".Trash", ".Spotlight-V100", ".fseventsd"]);
const SKIP_EXTS = new Set(["tmp", "part", "crdownload", "download", "ds_store"]);

function isMountedOrExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function safeRel(base, full) {
  const rel = path.relative(base, full).replace(/\\/g, "/");
  return rel.startsWith("../") ? null : rel;
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(filePath);
    s.on("error", reject);
    s.on("data", (d) => h.update(d));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

async function walkFiles(root, out) {
  let entries = [];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkFiles(full, out);
      if (out.length >= MAX_FILES) return;
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase().replace(".", "");
    if (SKIP_EXTS.has(ext)) continue;
    out.push(full);
    if (out.length >= MAX_FILES) return;
  }
}

function deviceRootName(srcRoot) {
  return path.basename(srcRoot).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
}

function buildDest(srcRoot, srcFile) {
  const rel = safeRel(srcRoot, srcFile);
  if (!rel) return null;
  return path.join(NAS_BACKUP_ROOT, "devices", DEVICE, deviceRootName(srcRoot), rel);
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function readStatSafe(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

async function copyIfNeeded(src, dest) {
  const srcSt = await readStatSafe(src);
  if (!srcSt || !srcSt.isFile() || srcSt.size < MIN_FILE_BYTES) return { action: "skip", reason: "source_missing_or_small" };

  const destSt = await readStatSafe(dest);
  const sameMeta = !!destSt && destSt.size === srcSt.size && Math.floor(destSt.mtimeMs) >= Math.floor(srcSt.mtimeMs);
  if (!VERIFY_ONLY && sameMeta) return { action: "skip", reason: "up_to_date", srcSt, destSt };

  if (!VERIFY_ONLY) {
    if (!DRY_RUN) {
      await ensureDir(path.dirname(dest));
      await fsp.copyFile(src, dest);
      await fsp.utimes(dest, srcSt.atime, srcSt.mtime);
    }
    const postDest = await readStatSafe(dest);
    if (!DRY_RUN && (!postDest || postDest.size !== srcSt.size)) {
      return { action: "fail", reason: "copy_size_mismatch", srcSt, destSt: postDest };
    }
  }

  if (DRY_RUN) return { action: VERIFY_ONLY ? "verify" : "copy", reason: "dry_run", srcSt, destSt };

  const [srcHash, destHash] = await Promise.all([sha256File(src), sha256File(dest)]);
  if (srcHash !== destHash) return { action: "fail", reason: "sha_mismatch", srcSt, destSt: await readStatSafe(dest), srcHash, destHash };

  return { action: VERIFY_ONLY ? "verify" : "copy", reason: "ok", srcSt, destSt: await readStatSafe(dest), srcHash, destHash };
}

async function appendLedger(entries) {
  const ledgerDir = path.join(NAS_BACKUP_ROOT, "_backup_ledger");
  await ensureDir(ledgerDir);
  const ledgerPath = path.join(ledgerDir, `${DEVICE}.jsonl`);
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  await fsp.appendFile(ledgerPath, `${lines}\n`, "utf8");
  return ledgerPath;
}

async function main() {
  if (!SOURCE_ROOTS.length) {
    throw new Error("No source roots configured. Set BACKUP_SOURCE_ROOTS or pass --roots \"<a>|<b>\"");
  }
  if (!isMountedOrExists(NAS_BACKUP_ROOT)) {
    throw new Error(`NAS backup root not reachable: ${NAS_BACKUP_ROOT}`);
  }

  const startedAt = new Date().toISOString();
  console.log(`[backup-to-nas] start device=${DEVICE} dry_run=${DRY_RUN} verify_only=${VERIFY_ONLY}`);
  console.log(`[backup-to-nas] nas_root=${NAS_BACKUP_ROOT}`);

  const files = [];
  for (const root of SOURCE_ROOTS) {
    const abs = path.resolve(root);
    if (!isMountedOrExists(abs)) {
      console.warn(`[backup-to-nas] skip missing root: ${abs}`);
      continue;
    }
    await walkFiles(abs, files);
    if (files.length >= MAX_FILES) break;
  }

  const metrics = {
    scanned: files.length,
    copied: 0,
    verified: 0,
    skipped: 0,
    failed: 0,
    bytes_copied: 0,
  };
  const ledgerEntries = [];
  const failures = [];

  for (const src of files) {
    let srcRoot = SOURCE_ROOTS.map((r) => path.resolve(r)).find((r) => src.startsWith(r + path.sep) || src === r);
    if (!srcRoot) continue;
    const dest = buildDest(srcRoot, src);
    if (!dest) continue;

    let res;
    try {
      res = await copyIfNeeded(src, dest);
    } catch (err) {
      res = { action: "fail", reason: err.message || "unknown_error" };
    }

    if (res.action === "copy") {
      metrics.copied += 1;
      metrics.bytes_copied += Number(res.srcSt?.size || 0);
    } else if (res.action === "verify") {
      metrics.verified += 1;
    } else if (res.action === "skip") {
      metrics.skipped += 1;
    } else {
      metrics.failed += 1;
      failures.push({ src, dest, reason: res.reason });
    }

    ledgerEntries.push({
      ts: new Date().toISOString(),
      device: DEVICE,
      source_root: srcRoot,
      source_path: src,
      dest_path: dest,
      action: res.action,
      ok: res.action !== "fail",
      reason: res.reason || null,
      size_bytes: Number(res.srcSt?.size || 0),
      sha256: res.srcHash || null,
    });
  }

  const ledgerPath = DRY_RUN ? null : await appendLedger(ledgerEntries);

  const report = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    device: DEVICE,
    dry_run: DRY_RUN,
    verify_only: VERIFY_ONLY,
    nas_root: NAS_BACKUP_ROOT,
    source_roots: SOURCE_ROOTS,
    metrics,
    failures: failures.slice(0, 200),
    ledger_path: ledgerPath,
    ok: metrics.failed === 0,
  };

  const reportDir = path.join(__dirname, "reports");
  await ensureDir(reportDir);
  const reportPath = path.join(reportDir, `${Date.now()}-backup-to-nas.json`);
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[backup-to-nas] done scanned=${metrics.scanned} copied=${metrics.copied} verified=${metrics.verified} skipped=${metrics.skipped} failed=${metrics.failed}`);
  console.log(`[backup-to-nas] report=${reportPath}`);
  if (ledgerPath) console.log(`[backup-to-nas] ledger=${ledgerPath}`);

  if (!report.ok) process.exit(2);
}

main().catch((err) => {
  console.error(`[backup-to-nas] fatal: ${err.message}`);
  process.exit(1);
});


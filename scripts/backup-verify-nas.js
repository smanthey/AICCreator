#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const args = process.argv.slice(2);
const getArg = (f, fallback = "") => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const NAS_BACKUP_ROOT = path.resolve(String(getArg("--nas-root", process.env.NAS_BACKUP_ROOT || "/Volumes/home/Storage/_claw_backup")).trim());
const FRESH_HOURS = Math.max(1, Number(getArg("--fresh-hours", process.env.BACKUP_VERIFY_FRESH_HOURS || "24")) || 24);
const REQUIRED_DEVICES = String(getArg("--devices", process.env.BACKUP_REQUIRED_DEVICES || "PRIMARY_DEV_MACHINE,SECONDARY_DEV_MACHINE,Mac"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function pathExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readLines(file) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

async function latestEntriesForDevice(ledgerFile) {
  const lines = await readLines(ledgerFile);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore bad lines
    }
  }
  if (!rows.length) return [];

  const sorted = rows.slice().sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  const newestTs = sorted[sorted.length - 1].ts;
  if (!newestTs) return [];
  return sorted.filter((r) => r.ts === newestTs);
}

async function verifyEntries(entries) {
  let missing = 0;
  let failed = 0;
  let ok = 0;
  const sampleIssues = [];

  for (const e of entries) {
    const exists = await pathExists(e.dest_path);
    if (!exists) {
      missing += 1;
      if (sampleIssues.length < 30) sampleIssues.push({ type: "missing_dest", source: e.source_path, dest: e.dest_path });
      continue;
    }
    if (!e.ok || e.action === "fail") {
      failed += 1;
      if (sampleIssues.length < 30) sampleIssues.push({ type: "failed_copy", source: e.source_path, dest: e.dest_path, reason: e.reason || null });
      continue;
    }
    ok += 1;
  }
  return { ok, missing, failed, sampleIssues };
}

function detectDuplicateHashes(entries) {
  const byHash = new Map();
  for (const e of entries) {
    const h = String(e.sha256 || "");
    if (!h) continue;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(e.dest_path);
  }
  const dups = [];
  for (const [sha, paths] of byHash.entries()) {
    if (paths.length > 1) dups.push({ sha256: sha, copies: paths.length, sample_paths: paths.slice(0, 10) });
  }
  return dups;
}

async function main() {
  const startedAt = new Date().toISOString();
  const ledgerDir = path.join(NAS_BACKUP_ROOT, "_backup_ledger");
  if (!(await pathExists(ledgerDir))) {
    throw new Error(`Ledger directory not found: ${ledgerDir}`);
  }

  const now = Date.now();
  const devices = [];
  const allEntries = [];

  for (const device of REQUIRED_DEVICES) {
    const file = path.join(ledgerDir, `${device}.jsonl`);
    const entries = await latestEntriesForDevice(file);
    const latestTs = entries[0]?.ts || null;
    const ageHours = latestTs ? (now - new Date(latestTs).getTime()) / (1000 * 60 * 60) : null;
    const fresh = ageHours !== null && ageHours <= FRESH_HOURS;
    const checks = await verifyEntries(entries);
    const deviceOk = !!entries.length && fresh && checks.missing === 0 && checks.failed === 0;
    devices.push({
      device,
      ledger_file: file,
      entries: entries.length,
      latest_ts: latestTs,
      age_hours: ageHours === null ? null : Number(ageHours.toFixed(2)),
      fresh,
      ok: deviceOk,
      checks,
    });
    allEntries.push(...entries);
  }

  const dupGroups = detectDuplicateHashes(allEntries);
  const coverageOk = devices.every((d) => d.ok);
  const duplicatesOk = dupGroups.length === 0;
  const overallOk = coverageOk && duplicatesOk;

  const report = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    nas_root: NAS_BACKUP_ROOT,
    ledger_dir: ledgerDir,
    required_devices: REQUIRED_DEVICES,
    fresh_hours: FRESH_HOURS,
    coverage_ok: coverageOk,
    duplicates_ok: duplicatesOk,
    duplicate_groups: dupGroups.length,
    duplicate_samples: dupGroups.slice(0, 40),
    devices,
    ok: overallOk,
  };

  const reportDir = path.join(__dirname, "reports");
  await fsp.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${Date.now()}-backup-verify-nas.json`);
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[backup-verify-nas] report=${reportPath}`);
  console.log(`[backup-verify-nas] coverage_ok=${coverageOk} duplicates_ok=${duplicatesOk} duplicate_groups=${dupGroups.length}`);
  for (const d of devices) {
    console.log(`- ${d.device}: ok=${d.ok} entries=${d.entries} fresh=${d.fresh} age_h=${d.age_hours}`);
  }

  if (!overallOk) process.exit(2);
}

main().catch((err) => {
  console.error(`[backup-verify-nas] fatal: ${err.message}`);
  process.exit(1);
});


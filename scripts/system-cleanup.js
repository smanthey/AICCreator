#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const NOW = Date.now();

const RETENTION_DAYS = Math.max(1, Number(process.env.SYSTEM_CLEANUP_RETENTION_DAYS || "14"));
const REPORT_RETENTION_DAYS = Math.max(1, Number(process.env.SYSTEM_CLEANUP_REPORT_RETENTION_DAYS || String(RETENTION_DAYS)));
const TMP_RETENTION_DAYS = Math.max(1, Number(process.env.SYSTEM_CLEANUP_TMP_RETENTION_DAYS || "2"));
const PM2_LOG_MAX_MB = Math.max(5, Number(process.env.SYSTEM_CLEANUP_PM2_LOG_MAX_MB || "150"));
const PM2_TRUNCATE_MB = Math.max(1, Number(process.env.SYSTEM_CLEANUP_PM2_TRUNCATE_MB || "20"));
const HIGH_MEM_RESTART_ENABLED = String(process.env.SYSTEM_CLEANUP_PM2_RESTART_HIGH_MEM || "true").toLowerCase() === "true";
const HIGH_MEM_MB = Math.max(256, Number(process.env.SYSTEM_CLEANUP_PM2_RESTART_MB || "1024"));

function ageMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  } catch (_err) {
    return null;
  }
}

async function pathExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

async function removeOldFiles(dir, cutoffMs, metrics) {
  if (!(await pathExists(dir))) return;
  const files = await listFilesRecursive(dir);
  for (const file of files) {
    try {
      const st = await fsp.stat(file);
      if (NOW - st.mtimeMs >= cutoffMs) {
        metrics.deletedFiles += 1;
        metrics.freedBytes += st.size;
        await fsp.unlink(file);
      }
    } catch {
      // continue
    }
  }
}

async function removeEmptyDirs(dir) {
  if (!(await pathExists(dir))) return;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => removeEmptyDirs(path.join(dir, e.name))));
  try {
    const after = await fsp.readdir(dir);
    if (after.length === 0) {
      await fsp.rmdir(dir);
    }
  } catch {
    // keep
  }
}

async function truncateLargePm2Logs(metrics) {
  const pm2Logs = path.join(os.homedir(), ".pm2", "logs");
  if (!(await pathExists(pm2Logs))) return;
  const files = await listFilesRecursive(pm2Logs);
  const limitBytes = PM2_LOG_MAX_MB * 1024 * 1024;
  const keepBytes = PM2_TRUNCATE_MB * 1024 * 1024;
  for (const file of files) {
    if (!file.endsWith(".log")) continue;
    try {
      const st = await fsp.stat(file);
      if (st.size <= limitBytes) continue;
      const start = Math.max(0, st.size - keepBytes);
      const fd = await fsp.open(file, "r");
      const buf = Buffer.alloc(st.size - start);
      await fd.read(buf, 0, buf.length, start);
      await fd.close();
      await fsp.writeFile(file, buf);
      metrics.truncatedLogs += 1;
      metrics.freedBytes += Math.max(0, st.size - buf.length);
    } catch {
      // continue
    }
  }
}

async function cleanupTmp(metrics) {
  const tmp = os.tmpdir();
  const cutoffMs = ageMs(TMP_RETENTION_DAYS);
  let entries = [];
  try {
    entries = await fsp.readdir(tmp, { withFileTypes: true });
  } catch {
    return;
  }
  const clawLike = /^(claw|openclaw|playwright|puppeteer|tmp-claw|codex-)/i;
  for (const e of entries) {
    if (!clawLike.test(e.name)) continue;
    const full = path.join(tmp, e.name);
    try {
      const st = await fsp.stat(full);
      if (NOW - st.mtimeMs < cutoffMs) continue;
      if (e.isDirectory()) {
        await fsp.rm(full, { recursive: true, force: true });
      } else if (e.isFile()) {
        await fsp.unlink(full);
      }
      metrics.deletedTmp += 1;
    } catch {
      // continue
    }
  }
}

function maybeVacuumSqlite(metrics) {
  const dbs = [
    path.join(ROOT, "claw_architect.db"),
    path.join(ROOT, "ip_kb.sqlite"),
  ];
  for (const db of dbs) {
    if (!fs.existsSync(db)) continue;
    const sqliteCmd = process.platform === "darwin" ? "sqlite3" : "sqlite3";
    const out = safeExec(`${sqliteCmd} "${db}" "VACUUM;"`);
    if (out !== null) metrics.vacuumed += 1;
  }
}

function restartHighMemPm2(metrics) {
  if (!HIGH_MEM_RESTART_ENABLED) return;
  const raw = safeExec("pm2 jlist");
  if (!raw) return;
  let list = [];
  try {
    list = JSON.parse(raw);
  } catch {
    return;
  }
  for (const proc of list) {
    const name = String(proc?.name || "");
    const status = String(proc?.pm2_env?.status || "");
    const memory = Number(proc?.monit?.memory || 0);
    if (!name || status !== "online") continue;
    const memMb = memory / (1024 * 1024);
    if (memMb < HIGH_MEM_MB) continue;
    const ok = safeExec(`pm2 restart "${name}" --update-env`);
    if (ok !== null) metrics.restartedPm2 += 1;
  }
}

async function main() {
  const metrics = {
    deletedFiles: 0,
    deletedTmp: 0,
    truncatedLogs: 0,
    restartedPm2: 0,
    vacuumed: 0,
    freedBytes: 0,
  };

  console.log(`[system-cleanup] start retention_days=${RETENTION_DAYS} report_days=${REPORT_RETENTION_DAYS}`);

  await removeOldFiles(path.join(ROOT, "logs"), ageMs(RETENTION_DAYS), metrics);
  await removeOldFiles(path.join(ROOT, "reports"), ageMs(REPORT_RETENTION_DAYS), metrics);
  await removeOldFiles(path.join(ROOT, "scripts", "reports"), ageMs(REPORT_RETENTION_DAYS), metrics);
  await removeEmptyDirs(path.join(ROOT, "reports"));
  await removeEmptyDirs(path.join(ROOT, "scripts", "reports"));

  await truncateLargePm2Logs(metrics);
  await cleanupTmp(metrics);
  maybeVacuumSqlite(metrics);
  restartHighMemPm2(metrics);

  const freedMb = metrics.freedBytes / (1024 * 1024);
  console.log(
    `[system-cleanup] done deleted_files=${metrics.deletedFiles} deleted_tmp=${metrics.deletedTmp} truncated_logs=${metrics.truncatedLogs} restarted_pm2=${metrics.restartedPm2} vacuumed=${metrics.vacuumed} freed_mb=${freedMb.toFixed(2)}`
  );
}

main().catch((err) => {
  console.error(`[system-cleanup] fatal: ${err.message}`);
  process.exit(1);
});


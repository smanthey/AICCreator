#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "agent-streamline-pulse-latest.json");

const DISALLOWED_CHANNEL_PROCS = [
  "claw-gateway",
  "claw-discord-gateway",
  "claw-discord-health",
  "claw-team-telegram-summary",
];

const ALLOW_DUPLICATE_NAMES = new Set([
  "claw-worker-ai",
  "claw-worker-nas",
]);

function sh(cmd, timeout = 15000) {
  return spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env: process.env,
  });
}

function pm2List() {
  const r = sh("pm2 jlist", 10000);
  if (r.status !== 0) return [];
  try {
    const parsed = JSON.parse(String(r.stdout || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stopAndDelete(name) {
  sh(`pm2 stop ${name} >/dev/null 2>&1 || true`);
  sh(`pm2 delete ${name} >/dev/null 2>&1 || true`);
}

function main() {
  const processes = pm2List();
  const grouped = new Map();
  for (const p of processes) {
    const name = String(p.name || "");
    if (!name) continue;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(p);
  }

  const removed = [];
  const duplicates = [];

  for (const name of DISALLOWED_CHANNEL_PROCS) {
    if (grouped.has(name)) {
      stopAndDelete(name);
      removed.push(name);
    }
  }

  for (const [name, items] of grouped.entries()) {
    if (items.length <= 1) continue;
    if (ALLOW_DUPLICATE_NAMES.has(name)) continue;
    duplicates.push({
      name,
      count: items.length,
      statuses: items.map((x) => x.pm2_env?.status || "unknown"),
    });
  }

  sh("pm2 save", 30000);

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    removed_disallowed_channels: removed,
    duplicate_singleton_candidates: duplicates,
    remaining_processes: pm2List().map((p) => ({
      name: p.name,
      status: p.pm2_env?.status || "unknown",
      restarts: p.pm2_env?.restart_time || 0,
    })),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

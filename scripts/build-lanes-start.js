#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const DRY_RUN = hasFlag("--dry-run");
const STRICT = hasFlag("--strict");
const TIMEOUT_MS = Math.max(
  60_000,
  Number(getArg("--timeout-ms", process.env.BUILD_LANES_TIMEOUT_MS || "240000")) || 240_000
);

const LANES = [
  {
    id: "cookiespass",
    command: DRY_RUN ? "npm run -s cookiespass:mission:pulse -- --dry-run" : "npm run -s cookiespass:mission:pulse",
  },
  {
    id: "payclaw_launch",
    command: DRY_RUN ? "npm run -s payclaw:launch:dry" : "npm run -s payclaw:launch",
  },
  {
    id: "payclaw_chunks",
    command: DRY_RUN ? "npm run -s payclaw:dispatch:chunks:dry" : "npm run -s payclaw:dispatch:chunks",
  },
  {
    id: "gocrawdaddy",
    command: DRY_RUN ? "npm run -s gocrawdaddy:launch:dry" : "npm run -s gocrawdaddy:launch",
  },
];

function parseTrailingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.indexOf("{"); i >= 0; i = raw.indexOf("{", i + 1)) {
    const candidate = raw.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function runShell(line) {
  const started = Date.now();
  const r = spawnSync("bash", ["-lc", line], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  const status = Number(r.status || 0);
  const stdout = String(r.stdout || "");
  const stderr = String(r.stderr || "");
  const timedOut = r.signal === "SIGTERM" || r.signal === "SIGKILL";
  return {
    ok: status === 0,
    code: status,
    timed_out: timedOut,
    duration_ms: Date.now() - started,
    stdout_tail: stdout.slice(-4000),
    stderr_tail: stderr.slice(-2000),
    parsed: parseTrailingJson(stdout),
  };
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-build-lanes-start.json`);
  const latestPath = path.join(REPORT_DIR, "build-lanes-start-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

function summarize(rows) {
  const out = {
    lanes_total: rows.length,
    lanes_ok: rows.filter((r) => r.ok).length,
    lanes_failed: rows.filter((r) => !r.ok).length,
    queued_hint: 0,
    created_hint: 0,
  };
  for (const r of rows) {
    const p = r.parsed || {};
    if (typeof p.created_count === "number") out.created_hint += p.created_count;
    if (typeof p.chunks_queued === "number") out.queued_hint += p.chunks_queued;
    if (typeof p.tasks_created === "number") out.queued_hint += p.tasks_created;
  }
  return out;
}

function main() {
  const startedAt = new Date().toISOString();
  const results = LANES.map((lane) => {
    const r = runShell(lane.command);
    return {
      lane: lane.id,
      command: lane.command,
      ...r,
    };
  });

  const summary = summarize(results);
  const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    dry_run: DRY_RUN,
    strict: STRICT,
    timeout_ms: TIMEOUT_MS,
    summary,
    results,
  };

  const paths = writeReport(report);
  console.log(JSON.stringify({ ok: summary.lanes_failed === 0, summary, report: paths }, null, 2));

  if (STRICT && summary.lanes_failed > 0) {
    process.exit(1);
  }
}

main();


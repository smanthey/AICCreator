#!/usr/bin/env node
"use strict";

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");

function run(label, command, timeoutMs = 20000) {
  const started = Date.now();
  const res = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - started;
  return {
    label,
    command,
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    duration_ms: durationMs,
    stdout_tail: String(res.stdout || "").slice(-500),
    stderr_tail: String(res.stderr || "").slice(-500),
  };
}

function quantiles(values = []) {
  if (!values.length) return { p50: 0, p95: 0, max: 0 };
  const arr = [...values].sort((a, b) => a - b);
  const p = (q) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * q))];
  return { p50: p(0.5), p95: p(0.95), max: arr[arr.length - 1] };
}

function writeReport(name, payload) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[.:]/g, "-");
  const report = path.join(REPORT_DIR, `${ts}-${name}.json`);
  const latest = path.join(REPORT_DIR, `${name}-latest.json`);
  fs.writeFileSync(report, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2));
  return { report, latest };
}

function main() {
  const probes = [
    ["filesystem", "bash -lc './scripts/mcp-filesystem.sh --healthcheck'"],
    ["github", "bash -lc './scripts/mcp-github.sh --healthcheck'"],
    ["postgres", "bash -lc './scripts/mcp-postgres.sh --healthcheck'"],
    ["context7", "bash -lc './scripts/mcp-context7.sh --healthcheck'"],
    ["memory", "node ./scripts/mcp-memory-accelerator.js retrieve \"mcp benchmark probe\" architect 5"],
  ];

  const runs = probes.map(([label, command]) => run(label, command, 25000));
  const byServer = {};
  for (const r of runs) {
    byServer[r.label] = {
      ok: r.ok,
      code: r.code,
      duration_ms: r.duration_ms,
      error: r.ok ? null : (r.stderr_tail || r.stdout_tail || "probe failed").slice(-220),
    };
  }

  const latencies = runs.map((r) => r.duration_ms);
  const failCount = runs.filter((r) => !r.ok).length;
  const stats = quantiles(latencies);

  const payload = {
    ok: failCount === 0,
    generated_at: new Date().toISOString(),
    benchmark_set: ["filesystem", "github", "postgres", "context7", "memory"],
    summary: {
      total: runs.length,
      failed: failCount,
      success_rate: Number(((runs.length - failCount) / runs.length).toFixed(4)),
      latency_ms: stats,
    },
    servers: byServer,
    probes: runs,
  };

  const paths = writeReport("mcp-benchmark-pack", payload);
  console.log(JSON.stringify({ ...payload, report: paths }, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

main();

#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const CLAW_REPOS_ROOT = process.env.CLAW_REPOS_ROOT || "/Users/tatsheen/claw-repos";
const MAX_REPOS = Math.max(6, Number(process.env.CAPABILITY_FACTORY_PULSE_MAX_REPOS || "24"));
const REPORT_DIR = path.join(ROOT, "scripts", "reports");

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  return res;
}

function latestCapabilityReport() {
  const dir = path.join(ROOT, "reports", "capability-factory");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith("-summary.json")).sort();
  if (!files.length) return null;
  return path.join(dir, files[files.length - 1]);
}

function repoSubset(root, maxRepos) {
  try {
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, maxRepos);
    return dirs.join(",");
  } catch {
    return "";
  }
}

function writePulseReport(summary) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const out = path.join(REPORT_DIR, `${stamp}-capability-factory-pulse.json`);
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`[capability-factory-pulse] report=${out}`);
}

function main() {
  const startedAt = new Date().toISOString();
  console.log(`[capability-factory-pulse] start repos_root=${CLAW_REPOS_ROOT} max_repos=${MAX_REPOS}`);
  const reposArg = repoSubset(CLAW_REPOS_ROOT, MAX_REPOS);
  if (!reposArg) {
    throw new Error(`no repos found under ${CLAW_REPOS_ROOT}`);
  }

  const runRes = run("node", [
    "scripts/capability-factory.js",
    "--root", CLAW_REPOS_ROOT,
    "--repos", reposArg,
    "--max-files", "3500",
    "--max-file-bytes", "786432",
  ]);

  const summaryPath = latestCapabilityReport();
  const summary = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    run_exit_code: runRes.status,
    run_signal: runRes.signal || null,
    run_ok: runRes.status === 0,
    summary_path: summaryPath,
    repos_root: CLAW_REPOS_ROOT,
    max_repos: MAX_REPOS,
    repos: reposArg.split(","),
  };
  writePulseReport(summary);
  if (runRes.status !== 0) {
    console.warn(`[capability-factory-pulse] completed with non-zero exit=${runRes.status} (treated as findings, not crash)`);
  } else {
    console.log("[capability-factory-pulse] done");
  }
}

try {
  main();
} catch (err) {
  console.error("[capability-factory-pulse] fatal:", err.message);
  process.exit(1);
}

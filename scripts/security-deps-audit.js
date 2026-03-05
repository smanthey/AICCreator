#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ARGS = process.argv.slice(2);

const hasFlag = (flag) => ARGS.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = ARGS.indexOf(flag);
  return i >= 0 && i + 1 < ARGS.length ? ARGS[i + 1] : fallback;
};

const SEV_RANK = Object.freeze({ info: 1, low: 2, moderate: 3, high: 4, critical: 5 });

function normalizeThreshold(raw) {
  const key = String(raw || "critical").toLowerCase();
  if (!SEV_RANK[key]) {
    throw new Error(`invalid --fail-on severity: ${raw}`);
  }
  return key;
}

function extractFindings(parsed) {
  // npm v9/v10 returns vulnerabilities object keyed by package.
  const out = [];
  if (parsed && parsed.vulnerabilities && typeof parsed.vulnerabilities === "object") {
    for (const [name, v] of Object.entries(parsed.vulnerabilities)) {
      if (!v || typeof v !== "object") continue;
      out.push({
        package: name,
        severity: String(v.severity || "unknown").toLowerCase(),
        via: Array.isArray(v.via) ? v.via.map((x) => (typeof x === "string" ? x : x?.title || x?.name || "unknown")) : [],
        range: v.range || "",
        fix_available: v.fixAvailable || null,
      });
    }
  }
  return out;
}

function summarize(findings) {
  const by = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, unknown: 0 };
  for (const f of findings) {
    by[f.severity] = (by[f.severity] || 0) + 1;
  }
  return by;
}

function severityAtOrAbove(findings, threshold) {
  const t = SEV_RANK[threshold];
  return findings.filter((f) => SEV_RANK[f.severity] >= t);
}

function ensureReportsDir() {
  const dir = path.join(ROOT, "scripts/reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function main() {
  const jsonOnly = hasFlag("--json");
  const noFail = hasFlag("--no-fail");
  const failOn = normalizeThreshold(getArg("--fail-on", "critical"));

  const res = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 30,
  });

  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  let parsed;
  try {
    parsed = stdout ? JSON.parse(stdout) : {};
  } catch (err) {
    throw new Error(`unable to parse npm audit JSON: ${err.message}`);
  }

  const findings = extractFindings(parsed);
  const summaryBySeverity = summarize(findings);
  const failing = severityAtOrAbove(findings, failOn);

  const report = {
    generated_at: new Date().toISOString(),
    tool: "security-deps-audit",
    fail_on: failOn,
    audit_exit_code: Number(res.status || 0),
    summary: {
      findings_total: findings.length,
      findings_by_severity: summaryBySeverity,
      failing_total: failing.length,
      status: failing.length > 0 ? "fail" : "pass",
    },
    findings,
    stderr,
  };

  const reportsDir = ensureReportsDir();
  const outPath = path.join(reportsDir, `${Date.now()}-security-deps.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (!jsonOnly) {
    console.log("\n=== Security Dependency Audit ===\n");
    console.log(`fail_on: ${failOn}`);
    console.log(`findings_total: ${report.summary.findings_total}`);
    console.log(`critical/high/moderate/low/info: ${summaryBySeverity.critical}/${summaryBySeverity.high}/${summaryBySeverity.moderate}/${summaryBySeverity.low}/${summaryBySeverity.info}`);
    console.log(`failing_total: ${report.summary.failing_total}`);
    if (failing.length > 0) {
      for (const f of failing.slice(0, 25)) {
        console.log(`- [${f.severity}] ${f.package}`);
      }
      if (failing.length > 25) {
        console.log(`... ${failing.length - 25} more failing findings`);
      }
    }
    console.log(`report: ${outPath}`);
  }

  if (!noFail && failing.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`[security-deps-audit] fatal: ${err.message}`);
  process.exit(1);
}

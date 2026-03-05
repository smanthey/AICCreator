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

function runStep(step) {
  const started = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 30,
  });
  const ms = Date.now() - started;
  return {
    name: step.name,
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    ms,
    stdout: (res.stdout || "").trim().split("\n").slice(-50).join("\n"),
    stderr: (res.stderr || "").trim().split("\n").slice(-50).join("\n"),
  };
}

function ensureReportsDir() {
  const dir = path.join(ROOT, "scripts/reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function main() {
  const jsonOnly = hasFlag("--json");
  const noFail = hasFlag("--no-fail");
  const depFailOn = getArg("--dep-fail-on", "critical");

  const steps = [
    { name: "security_secrets", cmd: "npm", args: ["run", "security:secrets"] },
    { name: "security_runtime", cmd: "npm", args: ["run", "security:runtime"] },
    { name: "security_deps", cmd: "npm", args: ["run", "security:deps", "--", "--fail-on", depFailOn] },
    { name: "schema_audit", cmd: "npm", args: ["run", "schema:audit"] },
  ];

  const results = [];
  for (const step of steps) {
    const result = runStep(step);
    results.push(result);
  }

  const failures = results.filter((r) => !r.ok);
  const report = {
    generated_at: new Date().toISOString(),
    tool: "security-sweep",
    dep_fail_on: depFailOn,
    summary: {
      steps_total: results.length,
      failed: failures.length,
      status: failures.length ? "fail" : "pass",
    },
    steps: results,
  };

  const reportsDir = ensureReportsDir();
  const outPath = path.join(reportsDir, `${Date.now()}-security-sweep.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (!jsonOnly) {
    console.log("\n=== Security Sweep ===\n");
    for (const r of results) {
      console.log(`- ${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms}ms)`);
    }
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) {
        console.log(`- ${f.name} exit=${f.code}`);
        if (f.stderr) console.log(`  stderr: ${f.stderr.split("\n")[0]}`);
      }
    }
    console.log(`\nreport: ${outPath}`);
  }

  if (!noFail && failures.length) {
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`[security-sweep] fatal: ${err.message}`);
  process.exit(1);
}

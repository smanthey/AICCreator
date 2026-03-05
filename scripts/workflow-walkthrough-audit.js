#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(__dirname, "reports");
const STRICT = !process.argv.includes("--soft");

function run(cmd, args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: opts.timeoutMs || 240000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    cmd: `${cmd} ${args.join(" ")}`,
    ok: r.status === 0,
    code: r.status,
    duration_ms: Date.now() - started,
    stdout_tail: String(r.stdout || "").slice(-3000),
    stderr_tail: String(r.stderr || "").slice(-3000),
  };
}

function extractIssue(result) {
  const blob = `${result.stdout_tail}\n${result.stderr_tail}`.trim();
  if (!blob) return "unknown_error";
  const lines = blob.split(/\r?\n/).filter(Boolean);
  return lines[lines.length - 1].slice(0, 400);
}

function main() {
  const steps = [];
  const push = (name, r) => steps.push({ name, ...r });

  push("qa_fast", run("npm", ["run", "-s", "qa:fast"], { timeoutMs: 420000 }));
  push("status_redgreen", run("npm", ["run", "-s", "status:redgreen"]));
  push(
    "launch_e2e_strict_skip",
    run("node", ["./scripts/launch-e2e-matrix.js"], {
      env: { LAUNCH_E2E_FAIL_ON_SKIP: "true", LAUNCH_E2E_ALLOW_FULL: "false" },
      timeoutMs: 420000,
    })
  );
  push(
    "github_scan_strict_smoke",
    run("npm", ["run", "-s", "github:scan", "--", "--strict-baseline", "--require-smoke-e2e", "--limit", "200"], {
      timeoutMs: 420000,
    })
  );
  push("lead_status", run("node", ["./scripts/lead-pipeline.js", "--status"]));
  push("lead_send_dryrun", run("node", ["./scripts/daily-send-scheduler.js", "--dry-run"]));
  push("credit_oauth_check", run("npm", ["run", "-s", "credit:oauth:check"]));
  push("credit_live_loop", run("npm", ["run", "-s", "credit:e2e:live"], { timeoutMs: 420000 }));

  const failures = steps.filter((s) => !s.ok);
  const summary = {
    generated_at: new Date().toISOString(),
    strict: STRICT,
    total_steps: steps.length,
    passed_steps: steps.length - failures.length,
    failed_steps: failures.length,
    failures: failures.map((f) => ({ step: f.name, issue: extractIssue(f) })),
    steps,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${Date.now()}-workflow-walkthrough-audit.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log("\n=== Workflow Walkthrough Audit ===\n");
  console.log(`strict: ${STRICT ? "yes" : "no"}`);
  console.log(`steps: ${summary.total_steps}`);
  console.log(`passed: ${summary.passed_steps}`);
  console.log(`failed: ${summary.failed_steps}`);
  console.log(`report: ${reportPath}`);
  for (const s of steps) {
    console.log(`- ${s.name}: ${s.ok ? "PASS" : "FAIL"} (${s.duration_ms}ms)`);
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of summary.failures) {
      console.log(`- ${f.step}: ${f.issue}`);
    }
  }

  if (STRICT && failures.length) process.exit(1);
}

main();


#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { notifyMonitoring } = require("../control/monitoring-notify");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const CHECKFIX_LOCK_KEY = 91020402;

function cap(text, n = 2500) {
  const s = String(text || "");
  return s.length <= n ? s : `${s.slice(0, n)}\n...[truncated]`;
}

function run(cmd, args, timeoutMs = 8 * 60 * 1000) {
  const command = [cmd, ...args].join(" ");
  console.log(`[system-4h-checkfix] start: ${command}`);
  const startedAt = new Date().toISOString();
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  console.log(
    `[system-4h-checkfix] done: ${command} code=${Number(r.status || 0)}${r.error ? ` error=${String(r.error.message || r.error)}` : ""}`
  );
  return {
    command,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout_tail: cap(r.stdout),
    stderr_tail: cap(r.stderr),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function writeReport(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const latest = path.join(REPORTS_DIR, "system-4h-checkfix-latest.json");
  const stamped = path.join(REPORTS_DIR, `system-4h-checkfix-${Date.now()}.json`);
  fs.writeFileSync(latest, JSON.stringify(report, null, 2));
  fs.writeFileSync(stamped, JSON.stringify(report, null, 2));
  return { latest, stamped };
}

async function main() {
  const lock = await pg.query(`SELECT pg_try_advisory_lock($1) AS ok`, [CHECKFIX_LOCK_KEY]);
  if (!lock.rows?.[0]?.ok) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "checkfix_lock_held" }, null, 2));
    return 0;
  }

  const report = {
    generated_at: new Date().toISOString(),
    checks: {},
    fixes: {},
    verify: {},
    ok: true,
  };

  report.checks.bind_guard = run("npm", ["run", "-s", "security:bind:guard"]);
  report.checks.runtime = run("npm", ["run", "-s", "audit:runtime"]);
  report.checks.schema = run("npm", ["run", "-s", "schema:audit:json"]);
  report.checks.contract = run("npm", ["run", "-s", "audit:tasks"]);
  report.checks.progress_integrity = run("node", [
    "scripts/progress-integrity-audit.js",
    "--lock-timeout-ms",
    "6000",
    "--statement-timeout-ms",
    "30000",
    "--query-timeout-ms",
    "20000",
    "--fail-open-on-timeout",
  ]);

  // Use dry governor in the 4h loop to avoid long lock contention windows.
  report.fixes.task_governor = run("npm", ["run", "-s", "task:governor:dry"]);

  // Post-fix verification snapshot.
  report.verify.health = run("npm", ["run", "-s", "tasks:health"]);
  report.verify.redgreen = run("npm", ["run", "-s", "status:redgreen"]);

  const all = [
    ...Object.entries(report.checks)
      .filter(([k]) => k !== "progress_integrity")
      .map(([, v]) => v),
    ...Object.values(report.fixes),
    ...Object.values(report.verify),
  ];
  report.ok = all.every((x) => x.ok);

  const paths = writeReport(report);
  if (!report.ok) {
    const failedChecks = Object.entries(report.checks).filter(([, r]) => !r.ok).map(([k]) => k);
    const failedFixes = Object.entries(report.fixes).filter(([, r]) => !r.ok).map(([k]) => k);
    const failedVerify = Object.entries(report.verify).filter(([, r]) => !r.ok).map(([k]) => k);
    await notifyMonitoring(
      [
        "SYSTEM 4H CHECK/FIX FAILED",
        `time: ${report.generated_at}`,
        `failed_checks: ${failedChecks.join(", ") || "none"}`,
        `failed_fixes: ${failedFixes.join(", ") || "none"}`,
        `failed_verify: ${failedVerify.join(", ") || "none"}`,
        `report: ${paths.latest}`,
      ].join("\n")
    ).catch(() => {});
  }
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        checks_failed: Object.values(report.checks).filter((x) => !x.ok).length,
        checks_failed_advisory: report.checks.progress_integrity?.ok ? 0 : 1,
        checks_failed_hard: Object.entries(report.checks).filter(([k, x]) => k !== "progress_integrity" && !x.ok).length,
        fixes_failed: Object.values(report.fixes).filter((x) => !x.ok).length,
        verify_failed: Object.values(report.verify).filter((x) => !x.ok).length,
        report: paths.latest,
      },
      null,
      2
    )
  );

  return report.ok ? 0 : 1;
}

let exitCode = 0;
main()
  .then((code) => {
    exitCode = Number.isInteger(code) ? code : 0;
  })
  .catch((err) => {
    console.error("[system-4h-checkfix] fatal:", err.message);
    exitCode = 1;
  })
  .finally(async () => {
    await pg.query(`SELECT pg_advisory_unlock($1)`, [CHECKFIX_LOCK_KEY]).catch(() => {});
    await pg.end().catch(() => {});
    process.exit(exitCode);
  });

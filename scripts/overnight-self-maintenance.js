#!/usr/bin/env node
"use strict";

/**
 * overnight-self-maintenance.js  —  runs at 4:00 AM daily via PM2 cron
 *
 * Steps:
 *   1. update_packages      — npm install (captures what changed)
 *   2. update_gateway       — pm2 restart claw-discord-gateway --update-env
 *   3. update_skills_registry — node ./scripts/clawdhub.js sync
 *   4. gateway_health_check — node ./scripts/discord-health-check.js
 *
 * On completion, posts a structured report to #monitoring (Discord webhook)
 * via notifyMonitoring(). Report includes:
 *   - which steps ran / succeeded / failed
 *   - packages updated (parsed from npm output)
 *   - version numbers where detectable
 *   - any errors
 *
 * If anything fails, notifies with 🚨 and exits 1.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { notifyMonitoring } = require("../control/monitoring-notify");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "scripts", "reports");
const DRY_RUN = process.argv.includes("--dry-run");

function nowIso() {
  return new Date().toISOString();
}

function runStep(name, cmd, timeoutMs = 15 * 60 * 1000) {
  const started = Date.now();
  const p = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    name,
    command: cmd,
    ok: Number(p.status || 0) === 0,
    code: Number(p.status || 0),
    duration_ms: Date.now() - started,
    stdout_tail: String(p.stdout || "").slice(-1500),
    stderr_tail: String(p.stderr || "").slice(-1500),
  };
}

/**
 * Parse npm install stdout for updated packages.
 * Looks for lines like:  added 3 packages, changed 2 packages...
 * and captures package names from the verbose section.
 */
function parseNpmChanges(stdout) {
  const summary = stdout.match(/added \d+ packages?[^.]*\.|changed \d+ packages?[^.]*\.|removed \d+ packages?[^.]*/g) || [];
  // Pick up individual package@version lines
  const pkgLines = stdout.match(/\+ [\w@/.:-]+ [\d.]+/g) || [];
  return { summary: summary.join(" ").trim(), packages: pkgLines };
}

async function main() {
  const steps = [
    {
      name: "update_packages",
      cmd: "npm install --no-audit --no-fund --prefer-offline 2>&1 || npm install --no-audit --no-fund",
      timeout: 20 * 60 * 1000,
    },
    {
      name: "update_gateway",
      cmd: "pm2 restart claw-discord-gateway --update-env",
      timeout: 2 * 60 * 1000,
    },
    {
      name: "update_skills_registry",
      cmd: "node ./scripts/clawdhub.js sync",
      timeout: 5 * 60 * 1000,
    },
    {
      name: "gateway_health_check",
      cmd: "node ./scripts/discord-health-check.js",
      timeout: 2 * 60 * 1000,
    },
  ];

  const startedAt = nowIso();
  const results = [];

  for (const step of steps) {
    if (DRY_RUN) {
      results.push({
        name: step.name,
        command: step.cmd,
        ok: true,
        code: 0,
        duration_ms: 0,
        stdout_tail: "dry_run",
        stderr_tail: "",
      });
      continue;
    }
    console.log(`[overnight-maintenance] running: ${step.name}`);
    const out = runStep(step.name, step.cmd, step.timeout);
    results.push(out);
    if (!out.ok) {
      console.error(`[overnight-maintenance] step failed: ${step.name} (exit ${out.code})`);
      console.error(out.stderr_tail || out.stdout_tail);
      break; // stop on first failure
    }
    console.log(`[overnight-maintenance] ok: ${step.name} (${out.duration_ms}ms)`);
  }

  const ok = results.every((r) => r.ok);

  // Parse npm changes for report
  const npmResult = results.find((r) => r.name === "update_packages");
  const npmChanges = npmResult ? parseNpmChanges(npmResult.stdout_tail) : { summary: "", packages: [] };

  // Build report
  const report = {
    generated_at: nowIso(),
    started_at: startedAt,
    dry_run: DRY_RUN,
    ok,
    npm_changes: npmChanges,
    steps: results,
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = Date.now();
  const outPath = path.join(REPORTS_DIR, `${stamp}-overnight-maintenance.json`);
  const latest = path.join(REPORTS_DIR, "overnight-maintenance-latest.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latest, `${JSON.stringify(report, null, 2)}\n`);

  // Build Discord notification
  const stepLines = results.map((r) => {
    const icon = r.ok ? "✅" : "❌";
    const dur = r.duration_ms > 0 ? ` (${(r.duration_ms / 1000).toFixed(1)}s)` : "";
    return `${icon} ${r.name}${dur}`;
  }).join("\n");

  const npmSummary = npmChanges.summary ? `\n📦 npm: ${npmChanges.summary}` : "";
  const pkgDetail = npmChanges.packages.length
    ? `\n${npmChanges.packages.slice(0, 8).join(", ")}${npmChanges.packages.length > 8 ? ` +${npmChanges.packages.length - 8} more` : ""}`
    : "";
  const failedStep = results.find((r) => !r.ok);
  const errorDetail = failedStep
    ? `\n🔴 Error in \`${failedStep.name}\`:\n\`\`\`\n${(failedStep.stderr_tail || failedStep.stdout_tail).slice(0, 500)}\n\`\`\``
    : "";

  const summary = ok
    ? `✅ **4:00 AM Auto-Update complete** (${new Date().toLocaleTimeString("en-US")})\n${stepLines}${npmSummary}${pkgDetail}\nreport: \`${path.relative(ROOT, outPath)}\``
    : `🚨 **4:00 AM Auto-Update FAILED**\n${stepLines}${errorDetail}\nreport: \`${path.relative(ROOT, outPath)}\``;

  await notifyMonitoring(summary);
  console.log(summary.replace(/\*\*/g, "").replace(/```[^`]*```/g, "[error details]"));
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  const msg = `🚨 **4:00 AM maintenance crashed**\n\`${String(err.message || err)}\``;
  try {
    await notifyMonitoring(msg);
  } catch {}
  console.error(`[overnight-self-maintenance] fatal: ${err.message}`);
  process.exit(1);
});

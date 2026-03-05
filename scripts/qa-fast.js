#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHURN_IGNORES = [
  ".venv-openclaw-tools/",
  "agent-state/",
  "reports/",
  "scripts/reports/",
  ".runtime/",
];
const STEPS = [
  {
    name: "migrations-status",
    cmd: "npm",
    args: ["run", "migrate", "--", "--status"],
  },
  {
    name: "schema-audit",
    cmd: "npm",
    args: ["run", "schema:audit"],
  },
  {
    name: "task-contract-audit",
    cmd: "npm",
    args: ["run", "audit:tasks"],
  },
  {
    name: "agent-drift-audit",
    cmd: "npm",
    args: ["run", "audit:drift"],
  },
  {
    name: "topology",
    cmd: "npm",
    args: ["run", "verify:topology"],
  },
  {
    name: "runtime-audit",
    cmd: "npm",
    args: ["run", "audit:runtime"],
  },
  {
    name: "policy-gate-assert",
    cmd: "npm",
    args: ["run", "policy:assert"],
  },
  {
    name: "security-sweep",
    cmd: "npm",
    args: ["run", "security:sweep", "--", "--dep-fail-on", "critical"],
  },
  {
    name: "e2e-brand-control",
    cmd: "npm",
    args: ["run", "e2e:brand:control"],
  },
  {
    name: "credit-kb-validate",
    cmd: "npm",
    args: ["run", "credit:kb:validate"],
  },
  {
    name: "credit-autopilot-dry",
    cmd: "node",
    args: ["scripts/credit-autopilot.js", "--dry-run", "--limit-profiles", "20", "--limit-deadlines", "20"],
  },
  {
    name: "loyalty-maintenance",
    cmd: "npm",
    args: ["run", "loyalty:maintenance"],
  },
];

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function normalizeStatusPath(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const body = raw.replace(/^[ MADRCU?!]{1,2}\s+/, "").trim();
  if (!body) return null;
  if (body.includes(" -> ")) return body.split(" -> ").pop().trim();
  return body;
}

function listNonChurnStatus() {
  const out = spawnSync("git", ["status", "--short"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (Number(out.status || 0) !== 0) return [];
  const lines = String(out.stdout || "")
    .split(/\r?\n/)
    .map((line) => normalizeStatusPath(line))
    .filter(Boolean);
  return lines.filter((filePath) => !CHURN_IGNORES.some((prefix) => filePath.startsWith(prefix)));
}

function runStep(step, env) {
  console.log(`\n[qa-fast] ▶ ${step.name}`);
  const res = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });
  const code = Number(res.status || 0);
  if (code === 0) {
    console.log(`[qa-fast] ✓ ${step.name}`);
    return { name: step.name, ok: true, code };
  }
  console.log(`[qa-fast] ✗ ${step.name} (exit ${code})`);
  return { name: step.name, ok: false, code };
}

function main() {
  const cleanRoom = has("--clean-room");
  const env = {
    ...process.env,
    AGENT_DRIFT_SKIP_PM2: cleanRoom ? "1" : String(process.env.AGENT_DRIFT_SKIP_PM2 || ""),
  };
  const steps = cleanRoom
    ? STEPS.filter((step) => !["e2e-brand-control", "credit-autopilot-dry", "loyalty-maintenance"].includes(step.name))
    : STEPS;
  const baselineSet = new Set(cleanRoom ? listNonChurnStatus() : []);
  console.log(`[qa-fast] start ${new Date().toISOString()}${cleanRoom ? " (clean-room)" : ""}`);
  if (cleanRoom) {
    console.log(`[qa-fast] clean-room ignores: ${CHURN_IGNORES.join(", ")}`);
    console.log(`[qa-fast] baseline non-churn changes: ${baselineSet.size}`);
  }
  const results = [];
  for (const step of steps) {
    const r = runStep(step, env);
    results.push(r);
    if (!r.ok) {
      console.log(`[qa-fast] stop on first failure: ${r.name}`);
      process.exit(1);
    }
    if (cleanRoom) {
      const current = listNonChurnStatus();
      const newlyIntroduced = current.filter((p) => !baselineSet.has(p));
      if (newlyIntroduced.length > 0) {
        console.log("[qa-fast] ✗ clean-room drift detected (non-churn files changed during audit)");
        for (const p of newlyIntroduced.slice(0, 20)) {
          console.log(`- ${p}`);
        }
        process.exit(1);
      }
    }
  }
  console.log(`\n[qa-fast] complete ${new Date().toISOString()} all steps passed (${results.length})`);
}

main();

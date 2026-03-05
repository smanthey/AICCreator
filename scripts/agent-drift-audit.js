#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { TASK_ROUTING } = require("../config/task-routing");
const { SCHEMAS } = require("../schemas/payloads");
const { getRegisteredTypes } = require("../agents/registry");

const ROOT = path.join(__dirname, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const BG = require(path.join(ROOT, "ecosystem.background.config.js"));

const REQUIRED_TASK_TYPES = [
  "site_audit",
  "site_compare",
  "site_fix_plan",
  "site_extract_patterns",
  "repo_autofix",
  "brand_provision",
  "research_sync",
  "research_signals",
  "security_sweep",
  "github_observability_scan",
  "platform_health_report",
  "loyalty_process_webhooks",
  "loyalty_maintenance",
  "fetch_leads",
  "send_email",
];

const REQUIRED_NPM_SCRIPTS = [
  "tasks:health",
  "audit:deep",
  "audit:runtime",
  "audit:tasks",
  "schema:audit",
  "platform:daily",
  "status:redgreen",
  "ai:work:pulse",
  "flow:regression:pulse",
  "flow:regression:autofix:pulse",
  "git:sites:subagent:pulse",
  "lead:autopilot",
  "credit:autopilot",
  "loyalty:maintenance",
  "security:sweep",
  "brand:control-plane",
  "backlog:orchestrator",
  "security:remediate:queue",
  "credit:e2e:live",
];

const REQUIRED_BG_APPS = {
  always_on: [
    "claw-ollama",
    "claw-dispatcher",
    "claw-worker-nas",
    "claw-worker-ai",
    "claw-webhook-server",
    "claw-brand-control-plane",
    "claw-lead-autopilot-skynpatch",
    "claw-lead-autopilot-bws",
  ],
  scheduled: {
    "claw-platform-daily": "0 9 * * *",
    "claw-security-sweep": "17 * * * *",
    "claw-security-remediation-queue": "22 * * * *",
    "claw-credit-autopilot": "5 * * * *",
    "claw-credit-e2e-live-loop": "35 * * * *",
    "claw-loyalty-maintenance": "*/10 * * * *",
    "claw-ollama-maintenance": "*/10 * * * *",
    "claw-system-cleanup": "15 */6 * * *",
    "claw-backup-to-nas": "5 */2 * * *",
    "claw-backup-verify-nas": "35 */2 * * *",
    "claw-global-status-pulse": "*/15 * * * *",
    "claw-launch-e2e-matrix": "0 */2 * * *",
    "claw-ai-work-pulse": "*/30 * * * *",
    "claw-backlog-orchestrator": "*/10 * * * *",
    "claw-git-sites-subagent-pulse": "10,40 * * * *",
    "claw-github-scan-pulse": "5 * * * *",
    "claw-capability-factory-pulse": "15 * * * *",
    "claw-saas-opportunity-researcher": "20 * * * *",
    "claw-flow-regression-pulse": "20 * * * *",
    "claw-regression-autofix-pulse": "25 * * * *",
    "claw-utilization-autofill": "*/10 * * * *",
  },
};

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function envEnabled(name) {
  return /^(1|true|yes)$/i.test(String(process.env[name] || "").trim());
}

function ollamaHealthy() {
  try {
    const out = execSync("curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return Boolean(out && out.includes("models"));
  } catch {
    return false;
  }
}

function loadHandlers() {
  require("../agents/echo-agent");
  require("../agents/index-agent");
  require("../agents/classify-agent");
  require("../agents/report-agent");
  require("../agents/qa-agent");
  require("../agents/triage-agent");
  require("../agents/patch-agent");
  require("../agents/dedupe-agent");
  require("../agents/migrate-agent");
  require("../agents/claw-agent");
  require("../agents/orchestrator");
  require("../agents/github-sync-agent");
  require("../agents/site-audit-agent");
  require("../agents/media-detect-agent");
  require("../agents/media-enrich-agent");
  require("../agents/media-hash-agent");
  require("../agents/cluster-agent");
  require("../agents/stub-agents");
}

function pm2ListSafe() {
  try {
    const raw = execSync("pm2 jlist", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function fail(msg, failures) {
  failures.push(msg);
}

function checkContractCoverage(failures, warnings) {
  loadHandlers();
  const registered = new Set(getRegisteredTypes());
  const routing = new Set(Object.keys(TASK_ROUTING));
  const schemas = new Set(Object.keys(SCHEMAS));

  for (const type of REQUIRED_TASK_TYPES) {
    if (!registered.has(type)) fail(`missing registered handler: ${type}`, failures);
    if (!routing.has(type)) fail(`missing routing entry: ${type}`, failures);
    if (!schemas.has(type)) fail(`missing payload schema: ${type}`, failures);
  }

  const deterministicExpected = ["repo_autofix", "brand_provision", "loyalty_process_webhooks"];
  for (const type of deterministicExpected) {
    const r = TASK_ROUTING[type];
    if (!r) continue;
    const tags = Array.isArray(r.required_tags) ? r.required_tags : [];
    if (!tags.includes("deterministic")) {
      fail(`task ${type} is missing deterministic route tag`, failures);
    }
    if (!tags.includes("infra") && type !== "repo_autofix") {
      warnings.push(`task ${type} does not include infra tag`);
    }
  }
}

function checkNpmScripts(failures) {
  const scripts = PKG.scripts || {};
  for (const scriptName of REQUIRED_NPM_SCRIPTS) {
    if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      fail(`missing npm script: ${scriptName}`, failures);
    }
  }
}

function checkBackgroundConfig(failures) {
  const apps = Array.isArray(BG.apps) ? BG.apps : [];
  const appByName = new Map(apps.map((a) => [a.name, a]));

  for (const name of REQUIRED_BG_APPS.always_on) {
    const app = appByName.get(name);
    if (!app) {
      fail(`ecosystem.background missing app: ${name}`, failures);
      continue;
    }
    if (app.cron_restart) {
      fail(`always-on app ${name} incorrectly has cron_restart`, failures);
    }
  }

  for (const [name, cron] of Object.entries(REQUIRED_BG_APPS.scheduled)) {
    const app = appByName.get(name);
    if (!app) {
      fail(`ecosystem.background missing scheduled app: ${name}`, failures);
      continue;
    }
    if ((app.cron_restart || "").trim() !== cron) {
      fail(`scheduled app ${name} cron mismatch expected="${cron}" actual="${app.cron_restart || ""}"`, failures);
    }
  }
}

function checkPm2Runtime(failures, warnings) {
  const list = pm2ListSafe();
  if (!list.length) {
    warnings.push("pm2 jlist unavailable or empty; runtime process assertions skipped");
    return;
  }
  const statusByName = new Map(list.map((p) => [p.name, p.pm2_env?.status || "unknown"]));
  for (const name of REQUIRED_BG_APPS.always_on) {
    const status = statusByName.get(name);
    if (name === "claw-ollama" && status !== "online" && ollamaHealthy()) {
      warnings.push("pm2 app claw-ollama is not online, but local ollama endpoint is healthy (external manager owning port)");
      continue;
    }
    if (status !== "online") {
      fail(`pm2 app ${name} is not online (status=${status || "missing"})`, failures);
    }
  }
  for (const name of Object.keys(REQUIRED_BG_APPS.scheduled)) {
    const status = statusByName.get(name);
    if (!status) {
      fail(`pm2 scheduled app ${name} missing from process list`, failures);
    } else if (status === "errored") {
      fail(`pm2 scheduled app ${name} is errored`, failures);
    }
  }
}

function main() {
  const failures = [];
  const warnings = [];
  const skipPm2Runtime = has("--skip-pm2-runtime") || envEnabled("AGENT_DRIFT_SKIP_PM2");

  checkContractCoverage(failures, warnings);
  checkNpmScripts(failures);
  checkBackgroundConfig(failures);
  if (skipPm2Runtime) {
    warnings.push("pm2 runtime assertions skipped (clean-room mode)");
  } else {
    checkPm2Runtime(failures, warnings);
  }

  console.log("\n=== Agent Drift Audit ===\n");
  if (warnings.length) {
    console.log(`warnings: ${warnings.length}`);
    for (const w of warnings) console.log(`- WARN: ${w}`);
    console.log("");
  }

  if (failures.length) {
    console.log(`failures: ${failures.length}`);
    for (const f of failures) console.log(`- FAIL: ${f}`);
    process.exit(1);
  }

  console.log("OK: no drift detected against required agent/runtime baseline.");
  process.exit(0);
}

main();

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "artifacts", "autonomy");
const STATE_JSON = path.join(OUT_DIR, "kanban-state.json");
const BOARD_MD = path.join(OUT_DIR, "kanban-board.md");
const LOG_MD = path.join(OUT_DIR, "run-log.md");
const GOALS_MD = path.join(ROOT, "agent-state", "handoffs", "GOALS.md");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(GOALS_MD), { recursive: true });
}

function writeDefaultGoals() {
  if (fs.existsSync(GOALS_MD)) return;
  const lines = [
    "# Goals",
    "",
    "1. Build the ultimate company dashboard and data collector.",
    "2. Turn dashboard insights into an action-item center.",
    "3. Pull data from all selling channels.",
    "4. Build and operate a master inventory source of truth.",
    "",
    "# Operating Rules",
    "- Generate 5-10 useful tasks each morning.",
    "- Prioritize work that reduces risk and increases shipping speed.",
    "- Maintain a live Kanban board with To Do / In Progress / Done.",
  ];
  fs.writeFileSync(GOALS_MD, lines.join("\n"));
}

function loadState() {
  if (!fs.existsSync(STATE_JSON)) {
    return { generated_at: null, tasks: [], runs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_JSON, "utf8"));
  } catch {
    return { generated_at: null, tasks: [], runs: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_JSON, JSON.stringify(state, null, 2));
}

function taskTemplates() {
  return [
    {
      id: "priority_repo_major_daily",
      title: "P0: One major update per active repo daily",
      why: "Primary completion policy: ship one meaningful update + commit per repo daily, with top-weight on QuantFusion/CookiesPass/ClawPay-Roblox lanes.",
      command: "npm run -s repo:priority:major:daily",
      priority: 1,
      cadence_minutes: 30,
    },
    {
      id: "cookiespass_finish_pulse",
      title: "P0: Finish CookiesPass critical path using existing repo code",
      why: "Highest execution priority. Reuse working implementations from other repos for speed; avoid rebuilds.",
      command: "npm run -s cookiespass:mission:pulse",
      priority: 1,
      cadence_minutes: 30,
    },
    {
      id: "gocrawdaddy_build_lane",
      title: "Launch GoCrawdaddy SaaS build lane (OpenClaw VPS hosting)",
      why: "Converts system know-how into a net-new product instead of only fixing existing repos.",
      command: "npm run -s gocrawdaddy:launch",
      priority: 3,
      cadence_minutes: 120,
    },
    {
      id: "payclaw_launch",
      title: "P1: Launch/sync PayClaw and dispatch build chunks from source repos",
      why: "Second execution priority after CookiesPass. Reuse proven code from source repos to finish faster.",
      command: "npm run -s payclaw:launch && npm run -s payclaw:dispatch:chunks",
      priority: 1,
      cadence_minutes: 60,
    },
    {
      id: "captureinbound_integrity_lane",
      title: "P1: CaptureInbound multitenant integrity lane",
      why: "Highest production risk after PayClaw/CookiesPass is tenant-number mismatch and provisioning drift.",
      command: "npm run -s repo:priority:major:daily -- --only captureinbound",
      priority: 1,
      cadence_minutes: 60,
    },
    {
      id: "capture_release_hardening",
      title: "P1: capture release hardening lane",
      why: "Keeps compile checks trustworthy and finalizes usage-report scheduler execution path.",
      command: "npm run -s repo:priority:major:daily -- --only capture",
      priority: 1,
      cadence_minutes: 60,
    },
    {
      id: "infinitedata_integrity_lane",
      title: "P1: infinitedata integrity lane",
      why: "Closes indexed data-flow gaps quickly and keeps analytics persistence paths production-ready.",
      command: "npm run -s repo:priority:major:daily -- --only infinitedata",
      priority: 1,
      cadence_minutes: 90,
    },
    {
      id: "inbound_cookies_release_guard",
      title: "P2: Inbound-cookies webhook hardening lane",
      why: "Webhook integrity directly affects payment and messaging reliability in production.",
      command: "npm run -s repo:priority:major:daily -- --only inbound-cookies",
      priority: 2,
      cadence_minutes: 90,
    },
    {
      id: "autopay_ui_flow_integrity",
      title: "P2: autopay_ui flow integrity lane",
      why: "Small codebase with quick ROI from closing payment and webhook flow gaps.",
      command: "npm run -s repo:priority:major:daily -- --only autopay_ui",
      priority: 2,
      cadence_minutes: 90,
    },
    {
      id: "capability_factory_pulse",
      title: "Run capability factory pulse for SaaS rollout readiness",
      why: "Drives phase 1-3 standardization and closes production gaps.",
      command: "npm run -s capability:factory:pulse",
      priority: 1,
      cadence_minutes: 120,
    },
    {
      id: "marketplace_os",
      title: "Refresh marketplace services catalog/listings/dashboard",
      why: "Keeps productized offers, listings, and fulfillment pipeline current.",
      command: "npm run -s market:services:catalog && npm run -s market:services:listings && npm run -s market:jobs:dashboard",
      priority: 1,
      cadence_minutes: 120,
    },
    {
      id: "agency_growth_os",
      title: "Refresh agency growth OS model and monetization pack",
      why: "Maintains 100k/month execution math and sellable implementation packs.",
      command: "npm run -s agency:plan -- --target-monthly 100000 --avg-setup 3500 --avg-retainer 1250 --new-setups-per-month 8 && npm run -s agency:audit:pack -- --repo usipeorg",
      priority: 1,
      cadence_minutes: 120,
    },
    {
      id: "saas_opportunity",
      title: "Refresh SaaS opportunity research",
      why: "Finds high-demand launches using existing capabilities.",
      command: "npm run -s saas:opportunity:research",
      priority: 2,
      cadence_minutes: 120,
    },
    {
      id: "affiliate_research",
      title: "Refresh affiliate rollout research",
      why: "Adds monetization channels to SaaS/site stack.",
      command: "npm run -s affiliate:research -- --limit 20",
      priority: 2,
      cadence_minutes: 180,
    },
    {
      id: "status_redgreen",
      title: "Run global red/green status and capture blockers",
      why: "Keeps platform health visible while monetization work runs.",
      command: "npm run -s status:redgreen",
      priority: 2,
      cadence_minutes: 60,
    },
    {
      id: "launch_matrix",
      title: "Run launch E2E matrix to detect flow regressions",
      why: "Protects production paths for active SaaS repos.",
      command: "npm run -s e2e:launch:matrix",
      priority: 3,
      cadence_minutes: 120,
    },
    {
      id: "qa_blocking",
      title: "Run human-grade QA (blocking targets)",
      why: "Catches high-risk gaps beyond baseline scanner.",
      command: "npm run -s qa:human:blocking -- --no-fail-on-high",
      priority: 3,
      cadence_minutes: 240,
    },
    {
      id: "repo_scan_strict",
      title: "Scan managed repos with strict baseline",
      why: "Prevents drift and hidden repo-level breakage.",
      command: "npm run -s github:scan -- --strict-baseline --limit 120",
      priority: 3,
      cadence_minutes: 120,
    },
    {
      id: "inventory_schema_audit",
      title: "Audit inventory/data schema mismatches",
      why: "Schema integrity protects all autonomous workflows from silent breakage.",
      command: "npm run -s schema:audit:json",
      priority: 4,
      cadence_minutes: 240,
    },
    {
      id: "dashboard_kpi_refresh",
      title: "Refresh daily progress snapshot",
      why: "Feeds action center with current metrics.",
      command: "npm run -s daily:progress",
      priority: 4,
      cadence_minutes: 60,
    },
    {
      id: "agent_memory_audit",
      title: "Run agent memory audit and maintenance",
      why: "Keeps autonomous behavior improving with less drift.",
      command: "npm run -s agent:memory:audit || true; npm run -s agent:memory:maintain -- --keep-days 7",
      priority: 5,
      cadence_minutes: 360,
    },
    {
      id: "copy_lab",
      title: "Generate copy/UI improvement suggestions",
      why: "Improves conversion-facing output quality for SaaS launches.",
      command: "npm run -s copy:lab -- --brand skynpatch --channel blog --topic \"SaaS monetization and onboarding conversion\" --audience \"small business owners and creators\" --goal \"increase trial-to-paid conversion\"",
      priority: 5,
      cadence_minutes: 180,
    },
  ];
}

function mergeTasks(state, maxTasks) {
  const existing = new Map(state.tasks.map((t) => [t.id, t]));
  const fresh = [];
  for (const t of taskTemplates()) {
    if (!existing.has(t.id)) {
      fresh.push({
        ...t,
        lane: "To Do",
        created_at: nowIso(),
        updated_at: nowIso(),
        attempts: 0,
        last_result: null,
      });
    } else {
      const current = existing.get(t.id);
      current.priority = t.priority;
      current.title = t.title;
      current.why = t.why;
      current.command = t.command;
      current.cadence_minutes = t.cadence_minutes;
    }
  }
  state.tasks.push(...fresh);

  // Keep top N by priority (plus existing done tasks for history)
  const active = state.tasks.filter((t) => t.lane !== "Done").sort((a, b) => (a.priority - b.priority));
  const keepActiveIds = new Set(active.slice(0, maxTasks).map((t) => t.id));
  state.tasks = state.tasks.filter((t) => t.lane === "Done" || keepActiveIds.has(t.id));
}

function refreshRecurringTasks(state) {
  const now = Date.now();
  for (const task of state.tasks) {
    const cadenceMinutes = Number(task.cadence_minutes || 0);
    if (!cadenceMinutes || !task.last_result?.at) continue;
    const lastAt = Date.parse(task.last_result.at);
    if (!Number.isFinite(lastAt)) continue;
    const dueAt = lastAt + cadenceMinutes * 60 * 1000;
    if (dueAt <= now && task.lane === "Done") {
      task.lane = "To Do";
      task.updated_at = nowIso();
    }
  }
}

function runCommand(command, timeoutMs) {
  const started = Date.now();
  const r = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CI: "1" },
  });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    duration_ms: Date.now() - started,
    stdout_tail: String(r.stdout || "").slice(-1500),
    stderr_tail: String(r.stderr || "").slice(-1500),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function appendRunLog(run) {
  const lines = [];
  lines.push(`## ${run.started_at}`);
  lines.push("");
  for (const a of run.actions) {
    lines.push(`- ${a.id}: ${a.ok ? "OK" : "FAIL"} (${a.duration_ms}ms)`);
  }
  lines.push("");
  fs.appendFileSync(LOG_MD, lines.join("\n") + "\n");
}

function renderBoard(state) {
  const byLane = (lane) => state.tasks.filter((t) => t.lane === lane);
  const laneMd = (title, arr) => {
    const lines = [`## ${title}`, ""];
    if (!arr.length) {
      lines.push("- (none)");
      lines.push("");
      return lines;
    }
    for (const t of arr) {
      const lr = t.last_result ? `${t.last_result.ok ? "OK" : "FAIL"} @ ${t.last_result.at}` : "not run yet";
      lines.push(`- [${t.id}] ${t.title}`);
      lines.push(`  - why: ${t.why}`);
      lines.push(`  - last: ${lr}`);
    }
    lines.push("");
    return lines;
  };

  const lines = [];
  lines.push("# Autonomous Goal Kanban");
  lines.push("");
  lines.push(`Updated: ${nowIso()}`);
  lines.push(`Goals file: ${GOALS_MD}`);
  lines.push("");
  lines.push(...laneMd("To Do", byLane("To Do")));
  lines.push(...laneMd("In Progress", byLane("In Progress")));
  lines.push(...laneMd("Done", byLane("Done")));
  fs.writeFileSync(BOARD_MD, lines.join("\n"));
}

function selectNext(state, limit) {
  return state.tasks
    .filter((t) => t.lane === "To Do")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
}

(function main() {
  ensureDir();
  writeDefaultGoals();

  const dryRun = has("--dry-run");
  const maxTasks = Math.max(5, Math.min(10, Number(arg("--tasks", "8")) || 8));
  const executeCount = Math.max(1, Math.min(5, Number(arg("--execute", "3")) || 3));
  const timeoutMs = Math.max(60_000, Number(arg("--timeout-ms", "1200000")) || 1_200_000);

  const state = loadState();
  mergeTasks(state, maxTasks);
  refreshRecurringTasks(state);

  const next = selectNext(state, executeCount);
  const run = { started_at: nowIso(), dry_run: dryRun, actions: [] };

  for (const t of next) {
    t.lane = "In Progress";
    t.updated_at = nowIso();

    let result;
    if (dryRun) {
      result = { ok: true, code: 0, duration_ms: 0, stdout_tail: "dry_run", stderr_tail: "", error: null };
    } else {
      result = runCommand(t.command, timeoutMs);
    }

    t.attempts = Number(t.attempts || 0) + 1;
    t.last_result = { ok: result.ok, at: nowIso(), code: result.code, duration_ms: result.duration_ms };
    t.updated_at = nowIso();

    if (result.ok) {
      t.lane = "Done";
    } else {
      t.lane = "To Do";
    }

    run.actions.push({
      id: t.id,
      title: t.title,
      command: t.command,
      ...result,
    });
  }

  state.generated_at = nowIso();
  state.runs = [run, ...(state.runs || [])].slice(0, 30);
  saveState(state);
  renderBoard(state);
  appendRunLog(run);

  const done = state.tasks.filter((t) => t.lane === "Done").length;
  const todo = state.tasks.filter((t) => t.lane === "To Do").length;
  const inProgress = state.tasks.filter((t) => t.lane === "In Progress").length;

  console.log("=== Goal Autopilot ===");
  console.log(`kanban_json: ${STATE_JSON}`);
  console.log(`kanban_md: ${BOARD_MD}`);
  console.log(`run_log: ${LOG_MD}`);
  console.log(`summary: todo=${todo} in_progress=${inProgress} done=${done} executed=${run.actions.length}`);
})();

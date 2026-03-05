#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const TARGET_REPOS = (process.env.COOKIESPASS_TARGET_REPOS || "CookiesPass,TempeCookiesPass,nirvaan/CookiesPass")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const REPORT_DIR = path.join(__dirname, "reports");

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function pulseSlot() {
  const now = new Date();
  const mins = now.getUTCMinutes();
  const slot = Math.floor(mins / 10) * 10;
  now.setUTCMinutes(slot, 0, 0);
  return now.toISOString().slice(0, 16);
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks WHERE idempotency_key=$1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload, priority = 5, dryRun = false) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", type, idempotencyKey };
  }

  if (dryRun) {
    return { created: true, dry_run: true, type, payload, priority, idempotencyKey };
  }

  const id = uuidv4();
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
    [id, type, JSON.stringify(payload || {}), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, priority };
}

async function queueMissionForRepo(repo, dryRun, slot) {
  const queued = [];

  queued.push(await createTaskIfNeeded("repo_autofix", {
    repo,
    source: "cookiespass_mission_pulse",
    reason: "p0_finish_cookiespass",
    checks_failed: ["e2e", "sms", "loyalty", "automation", "deployment"],
    directive: "P0 priority: finish CookiesPass before PayClaw and all other lanes.",
    symbol_index_required: "filesystem_mcp_rg_symbol_map_and_repo_mapper",
    pulse_slot: slot,
  }, 10, dryRun));

  queued.push(await createTaskIfNeeded("site_audit", {
    repo,
    source: "cookiespass_mission_pulse",
    objective: "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. After that, hard-audit full buyer/member flow: signup->sms->wallet pass->loyalty update->re-engagement automation.",
    depth: 5,
    symbol_index_required: "filesystem_mcp_rg_symbol_map_and_repo_mapper",
  }, 10, dryRun));

  queued.push(await createTaskIfNeeded("site_fix_plan", {
    repo,
    source: "cookiespass_mission_pulse",
    focus: "finish_cookiespass_critical_path",
    directive: "Execute only changes that move CookiesPass to done; defer non-blocking work.",
    symbol_index_required: "filesystem_mcp_rg_symbol_map_and_repo_mapper",
  }, 10, dryRun));

  return queued;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-cookiespass-mission-pulse.json`);
  const latestPath = path.join(REPORT_DIR, "cookiespass-mission-pulse-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const slot = pulseSlot();
  await ensureRoutingColumns();

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    pulse_slot: slot,
    target_repos: TARGET_REPOS,
    queued: [],
    created_count: 0,
    skipped_duplicates: 0,
  };

  for (const repo of TARGET_REPOS) {
    const tasks = await queueMissionForRepo(repo, dryRun, slot);
    report.queued.push({ repo, tasks });
    for (const t of tasks) {
      if (t.created) report.created_count += 1;
      else report.skipped_duplicates += 1;
    }
  }

  // Keep loyalty and outreach processing warm globally for demo reliability.
  for (const channel of ["sms", "wallet_pass", "email"]) {
    const t = await createTaskIfNeeded("loyalty_send_outreach", {
      limit: 200,
      channel,
      pulse_slot: slot,
      source: "cookiespass_mission_pulse",
    }, 9, dryRun);
    report.queued.push({ repo: "__global__", tasks: [t] });
    if (t.created) report.created_count += 1;
    else report.skipped_duplicates += 1;
  }

  const webhooksTask = await createTaskIfNeeded("loyalty_process_webhooks", {
    limit: 500,
    pulse_slot: slot,
    source: "cookiespass_mission_pulse",
  }, 9, dryRun);
  report.queued.push({ repo: "__global__", tasks: [webhooksTask] });
  if (webhooksTask.created) report.created_count += 1;
  else report.skipped_duplicates += 1;

  const paths = writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    repos: TARGET_REPOS,
    created_count: report.created_count,
    skipped_duplicates: report.skipped_duplicates,
    report: paths,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("[cookiespass-mission-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

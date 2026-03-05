#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { isKnownTaskType, resolveRouting } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const REPORT_DIR = path.join(__dirname, "reports");
const MAX_REPOS = Math.max(1, Number.parseInt(String(process.env.REGRESSION_AUTOFIX_MAX_REPOS || "8"), 10) || 8);
// Include DEAD_LETTER so already-failed tasks are not re-queued, preventing quarantine spam loops.
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "DEAD_LETTER"];

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, ACTIVE_TASK_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3,'CREATED',$4,$5,$6)`,
    [id, type, payload || {}, routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id, idempotencyKey };
}

function latestRegressionReportPath() {
  const files = fs
    .readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith("flow-regression-pulse.json"))
    .map((f) => ({
      file: f,
      ts: Number.parseInt(String(f).split("-")[0], 10) || 0,
    }))
    .sort((a, b) => b.ts - a.ts);
  if (!files.length) return null;
  return path.join(REPORT_DIR, files[0].file);
}

function normalizeFailureReason(f) {
  if (f.error) return String(f.error).slice(0, 100);
  const failed = (f.checks || []).find((c) => !c.ok);
  if (failed && failed.check) return `check:${failed.check}`;
  return "unknown";
}

function failedChecks(f) {
  return (f.checks || []).filter((c) => !c.ok).map((c) => String(c.check || "unknown"));
}

async function main() {
  console.log(`[regression-autofix-pulse] start max_repos=${MAX_REPOS}`);
  if (!fs.existsSync(REPORT_DIR)) {
    console.log("[regression-autofix-pulse] reports directory missing; skipping");
    return;
  }
  const reportPath = latestRegressionReportPath();
  if (!reportPath) {
    console.log("[regression-autofix-pulse] no flow-regression report found; skipping");
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const failures = (report.results || []).filter((r) => r.status === "fail").slice(0, MAX_REPOS);
  const pulseHour =
    (report.generated_at && String(report.generated_at).slice(0, 13)) ||
    new Date().toISOString().slice(0, 13);

  let queued = 0;
  let dupes = 0;
  for (const failure of failures) {
    const payload = {
      repo: failure.repo,
      source: "regression_autofix_pulse",
      reason: normalizeFailureReason(failure),
      checks_failed: failedChecks(failure),
      pulse_hour: pulseHour,
    };
    try {
      const res = await createTaskIfNeeded("repo_autofix", payload);
      if (res.created) {
        queued += 1;
        console.log(`[regression-autofix-pulse] queued repo_autofix repo=${payload.repo} reason=${payload.reason}`);
      } else {
        dupes += 1;
      }
    } catch (err) {
      console.error(`[regression-autofix-pulse] queue failed repo=${payload.repo} err=${err.message}`);
    }
  }

  console.log(
    `[regression-autofix-pulse] done failures=${failures.length} queued=${queued} skipped_duplicates=${dupes} report=${reportPath}`
  );
}

main()
  .catch((err) => {
    console.error("[regression-autofix-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

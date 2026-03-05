#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "forward-progress-enforcer-latest.json");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "PENDING"];

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
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

async function enqueueTask(type, payload) {
  return enqueueOnce({ type, payload, activeStatuses: ACTIVE_TASK_STATUSES });
}

async function metrics() {
  const { rows: r1 } = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= NOW() - INTERVAL '60 minutes')::int AS completed_1h,
       COUNT(*) FILTER (WHERE status IN ('CREATED','PENDING','DISPATCHED','RUNNING'))::int AS queue_active,
       COUNT(*) FILTER (WHERE status = 'DEAD_LETTER')::int AS dead_letter_open,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 minutes')::int AS created_1h
     FROM tasks`
  );
  const { rows: r2 } = await pg.query(
    `SELECT COUNT(*)::int AS plans_2h
       FROM plans
      WHERE created_at >= NOW() - INTERVAL '2 hours'`
  );
  const kpi = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "production-kpi-flywheel-latest.json"), "utf8"));
    } catch {
      return null;
    }
  })();
  return {
    completed_1h: Number(r1?.[0]?.completed_1h || 0),
    queue_active: Number(r1?.[0]?.queue_active || 0),
    dead_letter_open: Number(r1?.[0]?.dead_letter_open || 0),
    created_1h: Number(r1?.[0]?.created_1h || 0),
    plans_2h: Number(r2?.[0]?.plans_2h || 0),
    kpi_score: Number(kpi?.score || 0),
  };
}

function buildObjectives(m) {
  const out = [];
  if (m.completed_1h < 25 && m.queue_active > 120) {
    out.push({
      repo: "local/claw-architect",
      feature_key: "throughput_unstick",
      objective: "Forward progress enforcer: unstick queue throughput now by resolving top blockers in CREATED/PENDING and reducing queue_active by at least 20% this cycle.",
      severity: "high",
    });
  }
  if (m.dead_letter_open > 20) {
    out.push({
      repo: "local/claw-architect",
      feature_key: "deadletter_burn_down",
      objective: "Forward progress enforcer: burn down DEAD_LETTER backlog by fixing top repeated failure signatures and requeueing safe recoverable tasks.",
      severity: "high",
    });
  }
  if (m.plans_2h === 0 && m.kpi_score < 75) {
    out.push({
      repo: "local/payclaw",
      feature_key: "revenue_move_now",
      objective: "Forward progress enforcer: implement one revenue-moving change today (checkout friction removal, onboarding simplification, or payment status reconciliation improvement) with measurable KPI delta.",
      severity: "medium",
    });
  }
  return out;
}

async function main() {
  const m = await metrics();
  const objectives = buildObjectives(m);
  const queued = [];

  for (const o of objectives) {
    const payload = {
      repo: o.repo,
      source: "forward_progress_enforcer",
      feature_key: o.feature_key,
      objective: o.objective,
      quality_target: 90,
      max_iterations: 2,
      auto_iterate: true,
      force_implement: true,
      idempotency_key: `forward-progress:${o.feature_key}:${new Date().toISOString().slice(0, 13)}`,
      evidence: { metrics: m, severity: o.severity },
    };
    const r = await enqueueTask("opencode_controller", payload);
    queued.push({ ...o, ...r });
  }

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    metrics: m,
    objectives,
    queued,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[forward-progress-enforcer] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

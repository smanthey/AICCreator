"use strict";

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("./idempotency");

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "PENDING"];
const DEFAULT_TASK_TYPE = "opencode_controller";

let _schemaEnsured = false;
async function ensureTaskColumns() {
  if (_schemaEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_run_id TEXT`);
  _schemaEnsured = true;
}

function normalizeRepo(repo) {
  const raw = String(repo || "").trim();
  if (!raw) return "";
  if (raw.startsWith("local/")) return raw;
  return `local/${raw}`;
}

function sanitizeToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function defaultSteps(repo, featureKey, seedObjective) {
  const target = normalizeRepo(repo);
  const feature = sanitizeToken(featureKey || "general");
  const objective = String(seedObjective || "Improve quality and reliability").trim();

  return [
    {
      step: 1,
      label: "baseline-standards",
      objective:
        `Step 1/8 baseline for ${target} (${feature}). ` +
        `Index with jcodemunch, run repo_mapper, define explicit quality standards and entrypoints.\n` +
        `Seed objective: ${objective}`,
    },
    {
      step: 2,
      label: "targeted-probes",
      objective:
        `Step 2/8 targeted probes for ${target} (${feature}). ` +
        `Run minimal deterministic checks and collect concrete failures before broad tests.`,
    },
    {
      step: 3,
      label: "failure-symbol-map",
      objective:
        `Step 3/8 failure mapping for ${target} (${feature}). ` +
        `Map each observed failure to likely owning symbols/files and rank by impact.`,
    },
    {
      step: 4,
      label: "minimal-fix-set",
      objective:
        `Step 4/8 implementation for ${target} (${feature}). ` +
        `Apply smallest safe fix set to highest-impact owning symbols.`,
    },
    {
      step: 5,
      label: "targeted-retest",
      objective:
        `Step 5/8 targeted retest for ${target} (${feature}). ` +
        `Re-run only impacted checks first; iterate until targeted failures clear.`,
    },
    {
      step: 6,
      label: "broader-regression",
      objective:
        `Step 6/8 broader verification for ${target} (${feature}). ` +
        `Run impact-scoped regression and confirm no critical downstream breakage.`,
    },
    {
      step: 7,
      label: "learning-capture",
      objective:
        `Step 7/8 learning capture for ${target} (${feature}). ` +
        `Update symbol playbook with what worked, reusable patterns, and anti-patterns.`,
    },
    {
      step: 8,
      label: "promotion-next-loop",
      objective:
        `Step 8/8 promotion for ${target} (${feature}). ` +
        `Finalize upgrades, record outcomes, and queue the next feature loop seed.`,
    },
  ];
}

async function existingActiveWorkflow(workflowRunId) {
  const { rows } = await pg.query(
    `SELECT id
       FROM tasks
      WHERE workflow_run_id = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [workflowRunId, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function enqueueClosedLoopChain(options) {
  await ensureTaskColumns();

  const repo = normalizeRepo(options?.repo);
  if (!repo) throw new Error("repo is required");
  const featureKey = sanitizeToken(options?.feature_key || "general");
  const source = String(options?.source || "closed_self_correction_loop").trim();
  const qualityTarget = Math.max(1, Math.min(100, Number(options?.quality_target || 92)));
  const runDate = String(options?.run_date || new Date().toISOString().slice(0, 10));

  const workflowRunId =
    String(options?.workflow_run_id || "").trim() ||
    `closedloop-${sanitizeToken(repo)}-${featureKey}-${runDate}`;

  const { rows: lockRows } = await pg.query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
    [workflowRunId]
  );
  const locked = !!lockRows[0]?.locked;
  if (!locked) {
    return {
      created: false,
      reason: "workflow_lock_busy",
      workflow_run_id: workflowRunId,
      task_ids: [],
    };
  }

  try {
    if (await existingActiveWorkflow(workflowRunId)) {
      return {
        created: false,
        reason: "duplicate_active_workflow",
        workflow_run_id: workflowRunId,
        task_ids: [],
      };
    }

    const steps = Array.isArray(options?.steps) && options.steps.length
      ? options.steps
      : defaultSteps(repo, featureKey, options?.objective);

    const type = String(options?.type || DEFAULT_TASK_TYPE);
    if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);

    const routing = resolveRouting(type);
    const requiredTags = routing.required_tags || [];
    const workerQueue = routing.queue || "claw_tasks";

    const createdTaskIds = [];
    let dependsOn = [];
    let sequence = 1;
    let parentTaskId = null;

    for (const s of steps) {
      const stepNo = Number(s.step || sequence);
      const stepLabel = String(s.label || `step-${stepNo}`).trim();
      const payload = {
        repo,
        source,
        feature_key: featureKey,
        loop_step: stepNo,
        loop_label: stepLabel,
        loop_total_steps: steps.length,
        workflow_run_id: workflowRunId,
        objective: String(s.objective || "").trim(),
        max_iterations: stepNo <= 2 ? 1 : 2,
        quality_target: qualityTarget,
        auto_iterate: true,
        force_implement: true,
        closed_loop: true,
      };

      validatePayload(type, payload);

      const idempotencyKey = buildTaskIdempotencyKey(type, {
        ...payload,
        workflow_run_id: workflowRunId,
        loop_step: stepNo,
      });

      const id = uuidv4();
      const status = createdTaskIds.length === 0 ? "CREATED" : "PENDING";
      const title = `[ClosedLoop ${stepNo}/8] ${featureKey} @ ${repo}`;

      await pg.query(
        `INSERT INTO tasks
         (id, type, payload, status, priority, plan_id, parent_task_id, depends_on, depth, sequence, title,
          max_retries, backoff_ms, worker_queue, required_tags, idempotency_key, workflow_run_id)
         VALUES
         ($1, $2, $3::jsonb, $4, $5, NULL, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16)`,
        [
          id,
          type,
          JSON.stringify(payload),
          status,
          4,
          parentTaskId,
          dependsOn,
          createdTaskIds.length,
          sequence,
          title,
          3,
          5000,
          workerQueue,
          requiredTags,
          idempotencyKey,
          workflowRunId,
        ]
      );

      createdTaskIds.push(id);
      parentTaskId = id;
      dependsOn = [id];
      sequence += 1;
    }

    await pg.query(`SELECT pg_notify('task_created', $1)`, [createdTaskIds[0]]).catch(() => {});
    return {
      created: true,
      workflow_run_id: workflowRunId,
      task_ids: createdTaskIds,
      root_task_id: createdTaskIds[0] || null,
    };
  } finally {
    await pg.query(`SELECT pg_advisory_unlock(hashtext($1))`, [workflowRunId]).catch(() => {});
  }
}

module.exports = {
  enqueueClosedLoopChain,
  defaultSteps,
};

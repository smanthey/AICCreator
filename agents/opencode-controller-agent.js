"use strict";

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { register } = require("./registry");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

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
  if (await taskExists(idempotencyKey)) return { created: false, reason: "duplicate_active" };

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6)`,
    [id, type, JSON.stringify(payload || {}), routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id, type };
}

async function getLatestRepoHealth(repo) {
  try {
    const { rows } = await pg.query(
      `SELECT f.stack_health_score
         FROM github_repo_stack_facts f
         JOIN github_repo_scan_runs r ON r.id = f.run_id
        WHERE f.repo_name = $1
          AND r.status = 'completed'
        ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC
        LIMIT 1`,
      [repo]
    );
    const score = rows[0]?.stack_health_score;
    return typeof score === "number" ? score : null;
  } catch {
    return null;
  }
}

function buildPlan(payload) {
  return [
    {
      step: "plan",
      owner: "openclaw_brain",
      action: "Create bounded coding plan and quality gate",
      objective: payload.objective,
    },
    {
      step: "implement",
      owner: "opencode_executor",
      action: "Run deterministic implementation tasks on target repo",
      task_types: ["site_fix_plan", "repo_autofix"],
    },
    {
      step: "review",
      owner: "review_agents",
      action: "Run audits/checks and compare against quality target",
      task_types: ["site_audit", "github_repo_audit"],
    },
  ];
}

register("opencode_controller", async (payload) => {
  const repo = String(payload.repo || "").trim();
  const objective = String(payload.objective || "Implement requested coding task").trim();
  const source = String(payload.source || "opencode_controller");
  const iteration = Math.max(1, Number(payload.iteration || 1));
  const maxIterations = Math.max(iteration, Number(payload.max_iterations || 2));
  const qualityTarget = Math.max(1, Number(payload.quality_target || 90));
  const autoIterate = payload.auto_iterate !== false;
  const forceImplement = payload.force_implement === true;

  const healthScore = await getLatestRepoHealth(repo);
  const qualityPassed = typeof healthScore === "number" ? healthScore >= qualityTarget : false;
  const shouldQueueImplement = !qualityPassed || forceImplement;

  const plan = buildPlan({ objective, repo });
  const queued = [];

  if (shouldQueueImplement) {
    const implementPayload = {
      repo,
      source,
      reason: `opencode_implementation_iter_${iteration}: ${objective}`,
      checks_failed: ["build", "test", "flow"],
      pulse_hour: new Date().toISOString().slice(0, 13),
    };
    queued.push(await createTaskIfNeeded("site_fix_plan", { repo, source, reason: implementPayload.reason }));
    queued.push(await createTaskIfNeeded("repo_autofix", implementPayload));

    const reviewPayload = {
      repo,
      source,
      objective,
      iteration,
      quality_target: qualityTarget,
    };
    queued.push(await createTaskIfNeeded("site_audit", reviewPayload));
    queued.push(await createTaskIfNeeded("github_repo_audit", { repo, all: false, source }));
    queued.push(await createTaskIfNeeded("github_observability_scan", { repos: [repo], save: true, source }));

    if (autoIterate && iteration < maxIterations) {
      queued.push(
        await createTaskIfNeeded("opencode_controller", {
          repo,
          objective,
          source,
          iteration: iteration + 1,
          max_iterations: maxIterations,
          quality_target: qualityTarget,
          auto_iterate: true,
        })
      );
    }
  }

  const created = queued.filter((q) => q && q.created).length;
  const skipped = queued.filter((q) => !q || !q.created).length;
  return {
    repo,
    objective,
    source,
    iteration,
    max_iterations: maxIterations,
    quality_target: qualityTarget,
    latest_stack_health_score: healthScore,
    quality_passed: qualityPassed,
    plan,
    queued_tasks: queued,
    queued_created: created,
    queued_skipped: skipped,
    force_implement: forceImplement,
    next_action: qualityPassed && !forceImplement
      ? "quality_gate_passed_no_more_iterations"
      : (iteration < maxIterations && autoIterate
          ? "next_iteration_queued"
          : "await_review_results_then_requeue_if_needed"),
    cost_usd: 0,
    model_used: "openclaw-opencode-controller",
  };
});

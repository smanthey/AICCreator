// control/inserter.js
// Converts a TaskPlan (from planner.js) into real rows in the tasks table.
//
// Usage:
//   const inserter = require("./inserter");
//   const plan = await planner.plan("analyze captureinbound.com");
//   const { planId, taskIds } = await inserter.insertPlan(plan);

const { v4: uuid } = require("uuid");
const pg = require("../infra/postgres");
const { validatePayload } = require("../schemas/payloads");
const { verifyPlan } = require("../agents/verifier");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("./idempotency");

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

/**
 * Insert a plan and all its tasks into the database.
 * Tasks with no dependencies → CREATED (dispatcher picks them up).
 * Tasks with dependencies → PENDING (waits for queueDependents to unlock).
 *
 * @param {object} plan - TaskPlan from planner.js
 * @returns {Promise<{ planId: string, taskIds: Map<string, string> }>}
 */
async function insertPlan(plan) {
  await ensureRoutingColumns();
  const planId = plan.plan_id;
  const tasks  = plan.tasks;

  // ─── Step 0: Verify plan BEFORE touching DB ─────────────────
  // verifyPlan throws on hard errors (bad payload, guardrail violation, vague goal)
  await verifyPlan(plan);

  // ─── Step 1: Create plan record ────────────────────────────
  await pg.query(
    `INSERT INTO plans (id, goal, raw_plan, status, total_tasks, estimated_cost_usd, model_used,
                        intent_tier, intent_categories, rollback_plan, machines_involved, resource_estimates)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      planId,
      plan.goal,
      JSON.stringify(plan),
      tasks.length,
      plan.estimated_cost_usd || 0,
      plan.model_used || "claude-sonnet-4-5-20250929",   // planner sets this if Haiku was used
      plan.intent_tier        ?? 2,
      plan.intent_categories  || [],
      plan.rollback_plan      || null,
      plan.machines_involved  || [],
      JSON.stringify(plan.resource_estimates || {}),
    ]
  );

  // ─── Step 2: Assign real UUIDs ─────────────────────────────
  const tempToReal = new Map();
  for (const task of tasks) {
    tempToReal.set(task.temp_id, uuid());
  }

  // ─── Step 3: Topological sort for depth + sequence ─────────
  const depths = computeDepths(tasks);

  // ─── Step 4: Insert each task ──────────────────────────────
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const realId = tempToReal.get(t.temp_id);
    const effectivePayload = { ...(t.payload || {}) };
    if (t.type === "report" && !effectivePayload.plan_id) {
      effectivePayload.plan_id = planId;
    }

    // Resolve temp_id deps to real UUIDs
    const realDeps = (t.depends_on_temp_ids || []).map((tid) => {
      const real = tempToReal.get(tid);
      if (!real) throw new Error(`Unknown temp_id in depends_on: ${tid}`);
      return real;
    });

    // Parent = last dependency (for parent_task_id column)
    const parentId = realDeps.length > 0 ? realDeps[realDeps.length - 1] : null;

    // CREATED if no deps (ready to dispatch), PENDING if waiting
    const status = realDeps.length === 0 ? "CREATED" : "PENDING";

    const routing = resolveRouting(t.type);
    const workerQueue = routing.queue || "claw_tasks";
    const requiredTags = routing.required_tags || [];
    const idempotencyKey = buildTaskIdempotencyKey(t.type, effectivePayload || {});

    // ── Payload schema validation (catches planner hallucinations) ──
    try {
      validatePayload(t.type, effectivePayload);
    } catch (err) {
      throw new Error(`[inserter] Payload validation failed for task "${t.title}" (${t.type}): ${err.message}`);
    }

    await pg.query(
      `INSERT INTO tasks (
        id, type, payload, status, priority,
        plan_id, parent_task_id, depends_on, depth, sequence, title,
        max_retries, backoff_ms, worker_queue, required_tags
        , idempotency_key
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16
      )`,
      [
        realId,
        t.type,
        JSON.stringify(effectivePayload),
        status,
        t.priority || 3,
        planId,
        parentId,
        realDeps,
        depths.get(t.temp_id),
        i,
        t.title || "",
        t.max_retries || 3,
        5000,
        workerQueue,
        requiredTags,
        idempotencyKey,
      ]
    );

    console.log(
      `[inserter] ${status === "CREATED" ? "◉" : "○"} ` +
      `${t.type}:${realId.slice(0, 8)} "${t.title}" ` +
      `(depth ${depths.get(t.temp_id)}, deps: ${realDeps.length})`
    );
  }

  console.log(`[inserter] ✓ Plan ${planId}: ${tasks.length} tasks inserted`);

  // ─── pg_notify: wake dispatcher instantly instead of waiting 1s poll ─
  // Any process LISTENing to "task_created" will receive this immediately.
  // The dispatcher in telegram.js uses this to trigger dispatch without polling.
  await pg.query(`SELECT pg_notify('task_created', $1)`, [planId]).catch(() => {
    // Non-fatal — dispatcher will pick up on next poll if notify fails
  });

  return { planId, taskIds: tempToReal };
}

/**
 * Insert a plan built by the orchestrator from sub_goals (one merged plan, parallel roots).
 * Skips full verifyPlan; validates task types and payloads only.
 *
 * @param {object} plan - { plan_id, goal, tasks, estimated_cost_usd?, model_used?, intent_tier?, intent_categories?, rollback_plan?, machines_involved?, resource_estimates? }
 * @returns {Promise<{ planId: string, taskIds: Map<string, string> }>}
 */
async function insertPlanFromOrchestrator(plan) {
  await ensureRoutingColumns();
  const planId = plan.plan_id;
  const tasks  = plan.tasks;

  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("[inserter] Orchestrator plan must have non-empty tasks array");
  }

  // Light validation: known task types and payload schema (no LLM verifier)
  for (const t of tasks) {
    if (!isKnownTaskType(t.type)) {
      throw new Error(`[inserter] Unknown task type "${t.type}" in orchestrator plan`);
    }
    const effectivePayload = { ...(t.payload || {}) };
    if (t.type === "report" && !effectivePayload.plan_id) {
      effectivePayload.plan_id = planId;
    }
    try {
      validatePayload(t.type, effectivePayload);
    } catch (err) {
      throw new Error(`[inserter] Payload validation failed for task "${t.title || t.temp_id}" (${t.type}): ${err.message}`);
    }
  }

  const tempToReal = new Map();
  for (const task of tasks) {
    tempToReal.set(task.temp_id, uuid());
  }
  const depths = computeDepths(tasks);

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO plans (id, goal, raw_plan, status, total_tasks, estimated_cost_usd, model_used,
                          intent_tier, intent_categories, rollback_plan, machines_involved, resource_estimates)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        planId,
        plan.goal || "Orchestrator merged plan",
        JSON.stringify(plan),
        tasks.length,
        plan.estimated_cost_usd || 0,
        plan.model_used || null,
        plan.intent_tier ?? 2,
        plan.intent_categories || [],
        plan.rollback_plan || null,
        plan.machines_involved || [],
        JSON.stringify(plan.resource_estimates || {}),
      ]
    );

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const realId = tempToReal.get(t.temp_id);
      const effectivePayload = { ...(t.payload || {}) };
      if (t.type === "report" && !effectivePayload.plan_id) {
        effectivePayload.plan_id = planId;
      }
      const realDeps = (t.depends_on_temp_ids || []).map((tid) => {
        const real = tempToReal.get(tid);
        if (!real) throw new Error(`Unknown temp_id in depends_on: ${tid}`);
        return real;
      });
      const parentId = realDeps.length > 0 ? realDeps[realDeps.length - 1] : null;
      const status = realDeps.length === 0 ? "CREATED" : "PENDING";
      const routing = resolveRouting(t.type);
      const workerQueue = routing.queue || "claw_tasks";
      const requiredTags = routing.required_tags || [];
      const idempotencyKey = buildTaskIdempotencyKey(t.type, effectivePayload || {});

      await client.query(
        `INSERT INTO tasks (
          id, type, payload, status, priority,
          plan_id, parent_task_id, depends_on, depth, sequence, title,
          max_retries, backoff_ms, worker_queue, required_tags
          , idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16
        )`,
        [
          realId,
          t.type,
          JSON.stringify(effectivePayload),
          status,
          t.priority ?? 3,
          planId,
          parentId,
          realDeps,
          depths.get(t.temp_id),
          i,
          t.title || "",
          t.max_retries ?? 3,
          5000,
          workerQueue,
          requiredTags,
          idempotencyKey,
        ]
      );
      console.log(
        `[inserter] ${status === "CREATED" ? "◉" : "○"} ` +
        `${t.type}:${realId.slice(0, 8)} "${t.title || t.temp_id}" ` +
        `(depth ${depths.get(t.temp_id)}, deps: ${realDeps.length})`
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`[inserter] ✓ Orchestrator plan ${planId}: ${tasks.length} tasks inserted`);
  await pg.query(`SELECT pg_notify('task_created', $1)`, [planId]).catch(() => {});

  return { planId, taskIds: tempToReal };
}

/**
 * Compute depth for each task using Kahn's algorithm.
 * Root tasks (no deps) = depth 0, their children = depth 1, etc.
 */
function computeDepths(tasks) {
  const depths = new Map();
  const inDegree = new Map();
  const children = new Map(); // parent → [child temp_ids]

  for (const t of tasks) {
    inDegree.set(t.temp_id, (t.depends_on_temp_ids || []).length);
    children.set(t.temp_id, []);
  }

  for (const t of tasks) {
    for (const dep of t.depends_on_temp_ids || []) {
      children.get(dep).push(t.temp_id);
    }
  }

  // Start with root nodes (inDegree 0)
  const queue = [];
  for (const t of tasks) {
    if (inDegree.get(t.temp_id) === 0) {
      queue.push(t.temp_id);
      depths.set(t.temp_id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const currentDepth = depths.get(current);

    for (const child of children.get(current) || []) {
      const newDeg = inDegree.get(child) - 1;
      inDegree.set(child, newDeg);

      // Depth = max depth of all parents + 1
      const existingDepth = depths.get(child) || 0;
      depths.set(child, Math.max(existingDepth, currentDepth + 1));

      if (newDeg === 0) {
        queue.push(child);
      }
    }
  }

  return depths;
}

module.exports = { insertPlan, insertPlanFromOrchestrator };

// control/dispatcher.js
// Production-hardened dispatcher:
//   - FOR UPDATE SKIP LOCKED (concurrency safe)
//   - Audit log on every state transition
//   - Approval gate enforcement
//   - Timeout-aware stuck-task reaper
//   - Startup reconciliation

const { Queue, Worker } = require("bullmq");
const redis  = require("../infra/redis");
const pg     = require("../infra/postgres");
const { validateStatus } = require("../schemas/task");
const { validatePayload } = require("../schemas/payloads");
const { getHandler }     = require("../agents/registry");
const retry  = require("./retry");
const { evaluateTaskPolicyWithExternal } = require("./policy-engine");
const { DLQ_REASON, deadLetterTask } = require("./dlq");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("./idempotency");
const { sweepStaleExclusiveLocks } = require("./exclusive-lock");
const { quarantineTask, syncLegacyStaleQuarantine } = require("./quarantine");
const { reconcileStaleTaskRuns } = require("./task-runs");
const { getAiLaneHealth } = require("./ai-lane-health");
const { ensureIdleDevicesHaveWork, rebalanceWork } = require("./device-utilization");
const { buildSymbolContextPack } = require("./symbol-context");
const { resolveProfileForTask, compactProfileProjection } = require("./agent-focus-profiles");

// 🔹 Load ALL agents here
require("../agents/echo-agent");
require("../agents/index-agent");
require("../agents/report-agent");
require("../agents/stub-agents");

// Queue cache — one Queue instance per queue name
const _queues = new Map();
function getQueue(name) {
  if (!_queues.has(name)) {
    _queues.set(name, new Queue(name, { connection: redis }));
  }
  return _queues.get(name);
}

const WORKER_ID = `worker-${process.pid}`;
let _dispatchCycleCount = 0; // monotonic counter for periodic sub-tasks
let _lastAiGateLogAt = 0;
const DISPATCHED_REAP_SECONDS = Math.max(
  30,
  Number(process.env.DISPATCHED_REAP_SECONDS || "120") || 120
);
const DISPATCH_BATCH_LIMIT = Math.min(
  100,
  Math.max(1, parseInt(process.env.DISPATCH_BATCH_LIMIT || "10", 10) || 10)
);
// Hardware gating thresholds (percentage-based)
const CPU_LOAD_THRESHOLD = Math.max(0, Math.min(100, Number(process.env.WORKER_CPU_LOAD_THRESHOLD || 85)));
const MEMORY_USAGE_THRESHOLD = Math.max(0, Math.min(100, Number(process.env.WORKER_MEMORY_USAGE_THRESHOLD || 90)));
const OPENCODE_MAX_IN_FLIGHT_PER_LANE = Math.max(1, Number(process.env.OPENCODE_MAX_IN_FLIGHT_PER_LANE || 8) || 8);
const OPENCODE_MAX_CREATED_PER_LANE = Math.max(1, Number(process.env.OPENCODE_MAX_CREATED_PER_LANE || 24) || 24);
const ROUTING_HINT_TAGS = new Set(["infra", "deterministic", "ai", "qa", "cpu_heavy", "io_heavy"]);

function mergeRoutingHintsIntoTask(task, nextPayload) {
  const hintTags = Array.isArray(nextPayload?._symbol_context?.worker_hints)
    ? nextPayload._symbol_context.worker_hints.filter((t) => ROUTING_HINT_TAGS.has(t))
    : [];
  if (!hintTags.length) return false;
  if (!Array.isArray(task.required_tags) || !task.required_tags.length) return false;

  // Never narrow worker eligibility by enforcing extra tags.
  nextPayload._worker_routing_hints = Array.from(new Set([...(nextPayload._worker_routing_hints || []), ...hintTags]));
  return true;
}

function deriveProductLane(task) {
  const payload = task?.payload || {};
  const source = String(payload.source || "").toLowerCase();
  const repo = String(payload.repo || "").toLowerCase();
  const text = `${source} ${repo}`;
  if (text.includes("payclaw")) return "payclaw";
  if (text.includes("cookiespass")) return "cookiespass";
  if (text.includes("gocrawdaddy")) return "gocrawdaddy";
  return "shared";
}

async function getOpencodePressure(client) {
  const { rows } = await client.query(
    `
    WITH scoped AS (
      SELECT
        CASE
          WHEN LOWER(COALESCE(payload->>'source','') || ' ' || COALESCE(payload->>'repo','')) LIKE '%payclaw%' THEN 'payclaw'
          WHEN LOWER(COALESCE(payload->>'source','') || ' ' || COALESCE(payload->>'repo','')) LIKE '%cookiespass%' THEN 'cookiespass'
          WHEN LOWER(COALESCE(payload->>'source','') || ' ' || COALESCE(payload->>'repo','')) LIKE '%gocrawdaddy%' THEN 'gocrawdaddy'
          ELSE 'shared'
        END AS lane,
        status
      FROM tasks
      WHERE type = 'opencode_controller'
        AND status IN ('CREATED','DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL')
    )
    SELECT
      lane,
      COUNT(*) FILTER (WHERE status = 'CREATED')::int AS created,
      COUNT(*) FILTER (WHERE status IN ('DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL'))::int AS inflight
    FROM scoped
    GROUP BY lane
    `
  );
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.lane), {
      created: Number(row.created || 0),
      inflight: Number(row.inflight || 0),
    });
  }
  return map;
}

/* ================================================================
   AUDIT LOG
================================================================ */

async function writeAuditLog({ taskId, planId, fromStatus, toStatus, event, error }) {
  try {
    await pg.query(
      `INSERT INTO audit_log (task_id, plan_id, from_status, to_status, event, error, worker_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [taskId || null, planId || null, fromStatus || null, toStatus || null,
       event || null, error || null, WORKER_ID]
    );
  } catch (err) {
    // Audit log must never crash the main flow
    console.error("[audit] Failed to write audit log:", err.message);
  }
}

/* ================================================================
   STATUS HELPER
================================================================ */

async function moveToStatus(taskId, status, { client, planId, error } = {}) {
  validateStatus(status);

  const db = client || pg;

  const { rows } = await db.query(
    `UPDATE tasks
     SET status       = $1,
         started_at   = CASE WHEN $1 = 'RUNNING'   THEN NOW() ELSE started_at   END,
         completed_at = CASE WHEN $1 IN ('COMPLETED','FAILED','DEAD_LETTER')
                             THEN NOW() ELSE completed_at END
     WHERE id = $2
     RETURNING status, plan_id`,
    [status, taskId]
  );

  const prev = rows[0];
  await writeAuditLog({
    taskId,
    planId: planId || prev?.plan_id,
    fromStatus: prev?.status,
    toStatus: status,
    event: `status_transition`,
    error: error || null
  });
}

/* ================================================================
   DISPATCH LOOP — concurrency safe via FOR UPDATE SKIP LOCKED
================================================================ */

async function dispatchPendingTasks() {
  _dispatchCycleCount += 1;

  await retry.processRetryQueue();
  await refreshDeviceRegistryStatus();
  await syncLegacyStaleQuarantine().catch(() => {});

  // Ensure idle devices get work (run every dispatch cycle)
  await ensureIdleDevicesHaveWork().catch((err) => {
    console.warn("[dispatcher] Idle device work generation failed:", err.message);
  });

  // Rebalance work every 5th dispatch cycle (monotonic counter, no DB query needed).
  // Previous logic used completed-task count % 5, which was unpredictable and wasted
  // a pg query on every cycle even when rebalance wasn't going to run.
  if (_dispatchCycleCount % 5 === 0) {
    await rebalanceWork().catch((err) => {
      console.warn("[dispatcher] Work rebalancing failed:", err.message);
    });
  }

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    // Atomically claim CREATED tasks — limit via DISPATCH_BATCH_LIMIT (default 10)
    const { rows: tasks } = await client.query(
      `SELECT id, type, payload, plan_id, priority, retry_count, title,
              approval_required, timeout_seconds,
              COALESCE(worker_queue, 'claw_tasks') AS worker_queue,
              COALESCE(required_tags, '{}'::text[]) AS required_tags,
              idempotency_key,
              workflow_run_id
       FROM tasks
       WHERE status = 'CREATED'
         AND NOT EXISTS (
           SELECT 1
           FROM task_quarantine tq
           WHERE tq.task_id = tasks.id
             AND tq.active = TRUE
         )
       ORDER BY priority DESC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT ${DISPATCH_BATCH_LIMIT}`
    );

    const dispatched = [];
    const deadLettered = [];
    const opencodePressure = await getOpencodePressure(client).catch(() => new Map());
    const aiHealth = await getAiLaneHealth().catch((err) => ({
      ready: false,
      checked_at: new Date().toISOString(),
      ollama_ok: false,
      api_ok: false,
      openai_ok: false,
      anthropic_ok: false,
      reasons: { gate: `ai_health_probe_failed:${err.message}` },
    }));

    for (const task of tasks) {
      if (!isKnownTaskType(task.type)) {
        const msg = `Unknown task type "${task.type}"`;
        console.warn(`[dispatcher] skip ${task.type}:${task.id.slice(0,8)} — ${msg}`);
        await client.query(
          `UPDATE tasks SET last_error = $2 WHERE id = $1`,
          [task.id, msg]
        ).catch(() => {});
        writeAuditLog({
          taskId: task.id,
          planId: task.plan_id,
          fromStatus: "CREATED",
          toStatus: "CREATED",
          event: "dispatch_skip_unknown_type",
          error: msg,
        }).catch(() => {});
        continue;
      }

      if (!getHandler(task.type)) {
        const msg = `No handler registered for task type "${task.type}"`;
        console.warn(`[dispatcher] skip ${task.type}:${task.id.slice(0,8)} — ${msg}`);
        await client.query(
          `UPDATE tasks SET last_error = $2 WHERE id = $1`,
          [task.id, msg]
        ).catch(() => {});
        writeAuditLog({
          taskId: task.id,
          planId: task.plan_id,
          fromStatus: "CREATED",
          toStatus: "CREATED",
          event: "dispatch_skip_missing_handler",
          error: msg,
        }).catch(() => {});
        continue;
      }

      // ── Focus profile + symbol-aware context enrichment ───────────────────
      let payloadPatched = false;
      const nextPayload = { ...(task.payload || {}) };
      const hasFocusProfile = Boolean(
        nextPayload._focus_profile_id || nextPayload._focus_profile?.id
      );
      if (!hasFocusProfile) {
        const profile = resolveProfileForTask(task.type, nextPayload, {
          title: task.title || task.type,
          requiredTags: task.required_tags || [],
        });
        const primary = profile.primary || null;
        const candidates = (profile.candidates || []).slice(0, 3);
        if (primary) {
          nextPayload._focus_profile_id = primary.id;
          nextPayload._focus_profile = compactProfileProjection(primary, { maxGoals: 3, maxSkills: 10 });
          nextPayload._focus_intent = primary.intent;
          nextPayload._focus_profile_candidates = candidates.map((p) => ({
            id: p.id,
            name: p.name,
            intent: p.intent,
          }));
          payloadPatched = true;
        }
      }

      const symbolContext = buildSymbolContextPack({
        taskType: task.type,
        title: task.title || task.type,
        payload: nextPayload,
      });
      if (symbolContext) {
        nextPayload._symbol_context = symbolContext;
        payloadPatched = true;
        if (mergeRoutingHintsIntoTask(task, nextPayload)) {
          payloadPatched = true;
        }
      }

      if (payloadPatched) {
        task.payload = nextPayload;
        await client.query(
          `UPDATE tasks SET payload = $2::jsonb WHERE id = $1`,
          [task.id, JSON.stringify(task.payload)]
        ).catch(() => {});
      }

      // Ensure routing fields are populated even for legacy rows.
      if (!task.worker_queue || !Array.isArray(task.required_tags) || task.required_tags.length === 0) {
        const routing = resolveRouting(task.type);
        task.worker_queue = task.worker_queue || routing.queue || "claw_tasks";
        if (!Array.isArray(task.required_tags) || task.required_tags.length === 0) {
          task.required_tags = routing.required_tags || [];
        }
        task.idempotency_key = task.idempotency_key || buildTaskIdempotencyKey(task.type, {
          ...(task.payload || {}),
          ...(task.workflow_run_id ? { workflow_run_id: task.workflow_run_id } : {}),
        });
        await client.query(
          `UPDATE tasks
           SET worker_queue = $2,
               required_tags = $3,
               idempotency_key = $4
           WHERE id = $1`,
          [task.id, task.worker_queue, task.required_tags, task.idempotency_key]
        );
      } else if (!task.idempotency_key) {
        task.idempotency_key = buildTaskIdempotencyKey(task.type, {
          ...(task.payload || {}),
          ...(task.workflow_run_id ? { workflow_run_id: task.workflow_run_id } : {}),
        });
        await client.query(
          `UPDATE tasks SET idempotency_key = $2 WHERE id = $1`,
          [task.id, task.idempotency_key]
        );
      }

      // ── Approval gate ──────────────────────────────────────
      if (task.approval_required) {
        const { rows: approvals } = await client.query(
          `SELECT approved FROM plan_approvals
           WHERE plan_id = $1
             AND approved = true
             AND expires_at > NOW()`,
          [task.plan_id]
        );
        if (!approvals.length) {
          console.log(`[dispatcher] ⏸ ${task.type}:${task.id.slice(0,8)} — awaiting approval`);
          continue;
        }
      }

      // ── AI lane health gate ───────────────────────────────
      const isAiTask = Array.isArray(task.required_tags) && task.required_tags.includes("ai");
      if (isAiTask && !aiHealth.ready) {
        const now = Date.now();
        if (now - _lastAiGateLogAt > 15000) {
          _lastAiGateLogAt = now;
          console.warn(
            `[dispatcher] ⏸ ai-lane unavailable (ollama_ok=${aiHealth.ollama_ok} api_ok=${aiHealth.api_ok}) ` +
            `— deferring ai-tagged tasks`
          );
        }
        await client.query(
          `UPDATE tasks
              SET last_error = $2
            WHERE id = $1`,
          [
            task.id,
            `AI_LANE_UNAVAILABLE: ollama=${aiHealth.reasons?.ollama || "unknown"} ` +
            `openai=${aiHealth.reasons?.openai || "unknown"} anthropic=${aiHealth.reasons?.anthropic || "unknown"}`,
          ]
        ).catch(() => {});
        writeAuditLog({
          taskId: task.id,
          planId: task.plan_id,
          fromStatus: "CREATED",
          toStatus: "CREATED",
          event: "ai_lane_health_gate_deferred",
          error: `ollama_ok=${aiHealth.ollama_ok} api_ok=${aiHealth.api_ok}`,
        }).catch(() => {});
        continue;
      }

      // ── Worker tag gate ────────────────────────────────────
      const hasWorker = await hasEligibleWorker(client, task.required_tags || []);
      if (!hasWorker) {
        const msg = `No eligible online worker for required_tags=[${(task.required_tags || []).join(",")}]`;
        await deadLetterTask({
          taskId: task.id,
          reasonCode: DLQ_REASON.POLICY_BLOCKED,
          message: msg,
          client,
        });
        deadLettered.push({
          id: task.id,
          type: task.type,
          plan_id: task.plan_id,
          error: msg,
        });
        continue;
      }

      // ── Payload schema gate (Ajv + rule checks) ───────────
      try {
        validatePayload(task.type, task.payload || {});
      } catch (err) {
        await deadLetterTask({
          taskId: task.id,
          reasonCode: DLQ_REASON.INVALID_SCHEMA,
          message: err.message,
          client,
        });
        deadLettered.push({
          id: task.id,
          type: task.type,
          plan_id: task.plan_id,
          error: err.message,
        });
        continue;
      }

      // ── Per-lane opencode backlog pressure gate ───────────
      if (task.type === "opencode_controller") {
        const lane = deriveProductLane(task);
        const pressure = opencodePressure.get(lane) || { created: 0, inflight: 0 };
        if (pressure.inflight >= OPENCODE_MAX_IN_FLIGHT_PER_LANE || pressure.created >= OPENCODE_MAX_CREATED_PER_LANE) {
          const msg =
            `OPENCODE_LANE_CAP: lane=${lane} inflight=${pressure.inflight}/${OPENCODE_MAX_IN_FLIGHT_PER_LANE} ` +
            `created=${pressure.created}/${OPENCODE_MAX_CREATED_PER_LANE}`;
          await client.query(`UPDATE tasks SET last_error = $2 WHERE id = $1`, [task.id, msg]).catch(() => {});
          writeAuditLog({
            taskId: task.id,
            planId: task.plan_id,
            fromStatus: "CREATED",
            toStatus: "CREATED",
            event: "opencode_lane_cap_deferred",
            error: msg,
          }).catch(() => {});
          continue;
        }
        pressure.inflight += 1;
        if (pressure.created > 0) pressure.created -= 1;
        opencodePressure.set(lane, pressure);
      }

      // ── Mark DISPATCHED inside the transaction ─────────────
      await client.query(
        `UPDATE tasks SET status = 'DISPATCHED' WHERE id = $1`,
        [task.id]
      );
      dispatched.push(task);
    }

    await client.query("COMMIT");

    // ── Enqueue to Bull (idempotent via jobId) ─────────────
    for (const task of dispatched) {
      try {
        const q = getQueue(task.worker_queue || "claw_tasks");
        await q.add(
          task.type,
          {
            id:          task.id,
            type:        task.type,
            payload:     task.payload,
            plan_id:     task.plan_id,
            retry_count: task.retry_count || 0,
            idempotency_key: task.idempotency_key || null,
            workflow_run_id: task.workflow_run_id || null,
          },
          {
            jobId: task.id,
            priority: Math.max(1, Number(task.priority || 3) || 3),
          }
        );

        await writeAuditLog({
          taskId:    task.id,
          planId:    task.plan_id,
          fromStatus: "CREATED",
          toStatus:   "DISPATCHED",
          event:      "dispatched_to_queue"
        });

        console.log(`[dispatcher] → ${task.type}:${task.id.slice(0,8)}`);
      } catch (err) {
        const enqueueErr = `enqueue failed: ${err.message}`;
        await pg.query(
          `UPDATE tasks
           SET status = 'CREATED',
               last_error = $2,
               started_at = NULL
           WHERE id = $1`,
          [task.id, enqueueErr]
        ).catch(() => {});

        await writeAuditLog({
          taskId: task.id,
          planId: task.plan_id,
          fromStatus: "DISPATCHED",
          toStatus: "CREATED",
          event: "dispatch_enqueue_failed_requeued",
          error: enqueueErr,
        });

        console.error(`[dispatcher] ↩ ${task.type}:${task.id.slice(0,8)} ${enqueueErr}`);
      }
    }

    for (const task of deadLettered) {
      await writeAuditLog({
        taskId: task.id,
        planId: task.plan_id,
        fromStatus: "CREATED",
        toStatus: "DEAD_LETTER",
        event: "dead_letter_dispatch_gate",
        error: task.error,
      });
      if (task.plan_id) await retry.updatePlanStatus(task.plan_id).catch(() => {});
      console.warn(`[dispatcher] ☠ ${task.type}:${task.id.slice(0,8)} ${task.error}`);
    }

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[dispatcher] Dispatch loop error:", err.message);
  } finally {
    client.release();
  }
}

async function refreshDeviceRegistryStatus() {
  // offline if stale heartbeat beyond 30s
  await pg.query(
    `UPDATE device_registry
     SET status = CASE
       WHEN NOW() - last_heartbeat > INTERVAL '30 seconds' THEN 'offline'
       WHEN status = 'offline' THEN 'ready'
       ELSE status
     END,
     updated_at = NOW()`
  ).catch(() => {});

  // Keep legacy workers table clean so fallback routing/metrics are accurate.
  await pg.query(
    `DELETE FROM workers
     WHERE NOW() - last_seen > INTERVAL '10 minutes'`
  ).catch(() => {});
}

async function hasEligibleWorker(client, requiredTags) {
  const tags = Array.isArray(requiredTags) ? requiredTags : [];
  if (tags.length === 0) return true;

  // Prefer canonical device_registry.
  // Hardware gating: exclude workers with CPU load > threshold OR memory usage > threshold
  // NULL values are treated as eligible (backward compatibility)
  const { rows } = await client.query(
    `SELECT worker_id
     FROM device_registry
     WHERE status IN ('ready','busy')
       AND NOW() - last_heartbeat <= INTERVAL '30 seconds'
       AND tags @> $1::text[]
       AND (cpu_load_percent IS NULL OR cpu_load_percent <= $2)
       AND (
         free_mem_mb IS NULL 
         OR ram_gb IS NULL 
         OR ram_gb = 0
         OR ((1.0 - (free_mem_mb::numeric / (ram_gb::numeric * 1024))) * 100) <= $3
       )
     LIMIT 1`,
    [tags, CPU_LOAD_THRESHOLD, MEMORY_USAGE_THRESHOLD]
  ).catch(() => ({ rows: [] }));

  if (rows.length > 0) return true;

  // Backward-compatible fallback to workers table.
  const fb = await client.query(
    `SELECT worker_id
     FROM workers
     WHERE NOW() - last_seen <= INTERVAL '30 seconds'
       AND tags @> $1::text[]
     LIMIT 1`,
    [tags]
  ).catch(() => ({ rows: [] }));
  return fb.rows.length > 0;
}

/* ================================================================
   STUCK TASK REAPER — finds RUNNING tasks past their timeout
================================================================ */

async function reapStuckTasks() {
  const { reconciled } = await reconcileStaleTaskRuns({ staleSeconds: 1800 }).catch(() => ({ reconciled: 0 }));
  if (reconciled > 0) {
    console.log(`[reaper] 🧹 reconciled ${reconciled} stale task_runs records`);
  }

  const cleanedLocks = await sweepStaleExclusiveLocks(redis).catch(() => 0);
  if (cleanedLocks > 0) {
    console.log(`[reaper] 🔓 cleaned ${cleanedLocks} stale exclusive locks`);
  }

  // Tasks RUNNING longer than their timeout_seconds → move to RETRY
  const { rows: stuck } = await pg.query(
    `UPDATE tasks
     SET status    = 'RETRY',
         last_error = 'Task exceeded timeout — reaped by dispatcher',
         next_retry_at = NOW() + INTERVAL '30 seconds',
         retry_count = retry_count + 1
     WHERE status = 'RUNNING'
       AND started_at IS NOT NULL
       AND NOW() - started_at > (COALESCE(timeout_seconds, 300) * INTERVAL '1 second')
     RETURNING id, type, plan_id, retry_count, max_retries`
  );

  for (const task of stuck) {
    console.warn(`[reaper] ⏱ ${task.type}:${task.id.slice(0,8)} timed out — retry ${task.retry_count}/${task.max_retries}`);
    await writeAuditLog({
      taskId:    task.id,
      planId:    task.plan_id,
      fromStatus: "RUNNING",
      toStatus:   "RETRY",
      event:      "reaped_timeout"
    });

    // If retries exhausted, dead-letter it
    if (task.retry_count > task.max_retries) {
      await retry.handleFailure(task.id, new Error("Timeout — retries exhausted"));
    }
  }

  // Tasks DISPATCHED (but never picked up) longer than threshold → back to CREATED
  const { rows: lost } = await pg.query(
    `UPDATE tasks
     SET status = 'CREATED'
     WHERE status = 'DISPATCHED'
       AND NOW() - COALESCE(started_at, created_at) > ($1::int * INTERVAL '1 second')
       AND NOT EXISTS (
         SELECT 1
         FROM task_quarantine tq
         WHERE tq.task_id = tasks.id
           AND tq.active = TRUE
       )
     RETURNING id, type, plan_id`
  , [DISPATCHED_REAP_SECONDS]);

  for (const task of lost) {
    console.warn(`[reaper] 👻 ${task.type}:${task.id.slice(0,8)} was lost in DISPATCHED — re-queuing`);
    await writeAuditLog({
      taskId: task.id, planId: task.plan_id,
      fromStatus: "DISPATCHED", toStatus: "CREATED",
      event: "reaped_lost_dispatched"
    });

    const { rows: reapedCountRows } = await pg.query(
      `SELECT COUNT(*)::int AS c
       FROM audit_log
       WHERE task_id = $1
         AND event = 'reaped_lost_dispatched'
         AND created_at > NOW() - INTERVAL '60 minutes'`,
      [task.id]
    ).catch(() => ({ rows: [{ c: 0 }] }));

    const reapedCount = reapedCountRows[0]?.c || 0;
    if (reapedCount >= 5) {
      // deadLetterTask quarantines and notifies once; no separate quarantineTask call
      await deadLetterTask({
        taskId: task.id,
        reasonCode: DLQ_REASON.EXECUTION_ERROR,
        message: "stale dispatched requeue loop cleanup",
        metadata: { reaped_count_60m: reapedCount },
      }).catch(() => {});
      console.warn(`[reaper] ☠ quarantined stale task ${task.type}:${task.id.slice(0,8)} after ${reapedCount} lost dispatch cycles`);
    }
  }
}

/* ================================================================
   WORKER
================================================================ */

async function startWorker() {
  const worker = new Worker(
    "claw_tasks",
    async (job) => {
      const { id, type, payload, plan_id } = job.data;

      try {
        validatePayload(type, payload || {});
      } catch (e) {
        const err = new Error(e.message);
        err.code = DLQ_REASON.INVALID_SCHEMA;
        throw err;
      }

      const policy = await evaluateTaskPolicyWithExternal({ id, type, payload, plan_id });
      if (!policy.allowed) {
        const err = new Error(`POLICY_BLOCKED: ${policy.reason}`);
        err.code = DLQ_REASON.POLICY_BLOCKED;
        throw err;
      }

      await moveToStatus(id, "RUNNING", { planId: plan_id });

      const startTime = Date.now();
      const handler = getHandler(type);

      if (!handler) {
        throw new Error(`No handler registered for type "${type}"`);
      }

      const result = await handler(payload);
      const durationMs = Date.now() - startTime;

      await pg.query(
        `UPDATE tasks SET
           result     = $1,
           duration_ms = $2,
           cost_usd   = $3,
           model_used = $4
         WHERE id = $5`,
        [
          JSON.stringify(result || {}),
          durationMs,
          result?.cost_usd   || 0,
          result?.model_used || null,
          id
        ]
      );

      await moveToStatus(id, "COMPLETED", { planId: plan_id });
      await queueDependents(id);

      if (plan_id) await retry.updatePlanStatus(plan_id);

      return result;
    },
    { connection: redis }
  );

  worker.on("failed", async (job, err) => {
    if (!job?.data?.id) return;
      if (err?.code === DLQ_REASON.POLICY_BLOCKED || err?.code === DLQ_REASON.INVALID_SCHEMA) {
        await deadLetterTask({
          taskId: job.data.id,
          reasonCode: err.code,
          message: err.message,
        }).catch(() => {});
        if (job.data.plan_id) await retry.updatePlanStatus(job.data.plan_id).catch(() => {});
        return;
      }
    const outcome = await retry.handleFailure(job.data.id, err);
    if (outcome === "DEAD_LETTER" && job.data.plan_id) {
      await retry.updatePlanStatus(job.data.plan_id);
    }
  });

  worker.on("error", (err) => console.error("[worker] error:", err));

  console.log(`[worker] Started (${WORKER_ID}), listening on claw_tasks`);
}

/* ================================================================
   TASK CHAINING
================================================================ */

async function queueDependents(completedTaskId) {
  const { rows: candidates } = await pg.query(
    `SELECT id, depends_on FROM tasks
     WHERE $1 = ANY(depends_on) AND status = 'PENDING'`,
    [completedTaskId]
  );

  for (const candidate of candidates) {
    const { rows: deps } = await pg.query(
      `SELECT id, status FROM tasks
       WHERE id = ANY($1)`,
      [candidate.depends_on]
    );

    const blocking = deps.filter((d) => d.status !== "COMPLETED");
    if (blocking.length === 0) {
      await pg.query(`UPDATE tasks SET status = 'CREATED' WHERE id = $1`, [candidate.id]);
      console.log(`[chain] ↳ Unlocked task ${candidate.id.slice(0,8)}`);
      continue;
    }

    const failedDep = blocking.find((d) =>
      ["FAILED", "DEAD_LETTER", "SKIPPED", "CANCELLED"].includes(d.status)
    );
    if (failedDep) {
      await pg.query(
        `UPDATE tasks
            SET status = 'SKIPPED',
                last_error = $2
          WHERE id = $1`,
        [candidate.id, `Skipped: dependency ${failedDep.id} ${failedDep.status.toLowerCase()}`]
      );
      console.log(
        `[chain] ⊘ Skipped task ${candidate.id.slice(0,8)} ` +
        `(blocked by ${failedDep.id.slice(0,8)}:${failedDep.status})`
      );
    }
  }
}

/* ================================================================
   STARTUP RECONCILIATION — call once on boot
================================================================ */

async function recoverStuckTasks() {
  // DISPATCHED tasks older than threshold → CREATED (dispatcher crashed before Bull enqueue)
  const { rowCount: dispatched } = await pg.query(
    `UPDATE tasks SET status = 'CREATED'
     WHERE status = 'DISPATCHED'
       AND COALESCE(started_at, created_at) < NOW() - ($1::int * INTERVAL '1 second')
       AND NOT EXISTS (
         SELECT 1
         FROM task_quarantine tq
         WHERE tq.task_id = tasks.id
           AND tq.active = TRUE
       )`,
    [DISPATCHED_REAP_SECONDS]
  );

  // RUNNING tasks older than their timeout → RETRY
  const { rowCount: running } = await pg.query(
    `UPDATE tasks SET
       status = 'RETRY',
       last_error = 'Recovered from crash — was RUNNING on startup',
       next_retry_at = NOW() + INTERVAL '10 seconds',
       retry_count = retry_count + 1
     WHERE status = 'RUNNING'
       AND COALESCE(started_at, created_at) < NOW() - INTERVAL '10 minutes'`
  );

  if (dispatched > 0 || running > 0) {
    console.log(`[startup] Recovered ${dispatched} DISPATCHED, ${running} RUNNING tasks`);
    await writeAuditLog({ event: `startup_recovery: ${dispatched} dispatched, ${running} running` });
  }
}

/* ================================================================
   EXPORTS
================================================================ */


process.on('SIGTERM', async () => {
  console.log('[dispatcher] SIGTERM received, closing pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[dispatcher] SIGINT received, closing pool...');
  await pool.end();
  process.exit(0);
});

module.exports = {
  dispatchPendingTasks,
  startWorker,
  moveToStatus,
  queueDependents,
  recoverStuckTasks,
  reapStuckTasks,
  writeAuditLog
};

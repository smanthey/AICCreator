// workers/worker.js
// Standalone worker — run on any machine in the pool.
//
// Usage:
//   WORKER_TAGS=io_light,io_heavy node workers/worker.js
//   WORKER_TAGS=llm_local           node workers/worker.js
//
// The worker will consume from all queues that match its tags.
// Queue → tag mapping:
//   claw_tasks          → always consumed (control tasks)
//   claw_tasks_io       → io_light
//   claw_tasks_io_heavy → io_heavy
//   claw_tasks_llm      → llm_local OR llm_remote
//   claw_tasks_qa       → qa

require("dotenv").config();

const { validateConfig } = require("../infra/config");
validateConfig({ worker: true }); // Fail fast if env is misconfigured

const os     = require("os");
const { Worker } = require("bullmq");
const redis  = require("../infra/redis");
const pg     = require("../infra/postgres");
const { getHandler } = require("../agents/registry");
const { validatePayload } = require("../schemas/payloads");
const retry  = require("../control/retry");
const { evaluateTaskPolicyWithExternal } = require("../control/policy-engine");
const { DLQ_REASON, deadLetterTask } = require("../control/dlq");
const { resolveExclusiveKey, acquireExclusiveLock, renewExclusiveLock, releaseExclusiveLock } = require("../control/exclusive-lock");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { claimTaskRun, completeTaskRun, failTaskRun } = require("../control/task-runs");
const { insertFollowUpTasks } = require("../control/follow-up-tasks");
const { emitSignal } = require("../control/cross-agent-learning");

// Load agents this worker can handle
require("../agents/echo-agent");
require("../agents/index-agent");
require("../agents/classify-agent");     // classify — Ollama semantic tagging on file_index
require("../agents/report-agent");
require("../agents/qa-agent");
require("../agents/triage-agent");       // triage — Claude Haiku error diagnosis
require("../agents/patch-agent");        // patch — Claude Sonnet code fix (git branch)
require("../agents/dedupe-agent");       // dedupe — SHA-256 duplicate detection
require("../agents/migrate-agent");      // migrate — copy files to ClawVault
require("../agents/claw-agent");         // claw_search / claw_stats / claw_recent
require("../agents/orchestrator");       // orchestrate — FIO + multi-model routing
require("../agents/github-sync-agent");  // github_sync / github_repo_status / github_add_repo
require("../agents/site-audit-agent");   // site_audit / site_compare / site_fix_plan / site_extract_patterns
require("../agents/repo-autofix-agent"); // repo_autofix deterministic patch + reverify lane
require("../agents/opencode-controller-agent"); // opencode_controller plan→implement→review controller
require("../agents/brand-provision-agent"); // brand_provision centralized email provisioning lane
require("../agents/media-detect-agent"); // media_detect — deterministic media candidate summary
require("../agents/media-enrich-agent"); // media_enrich — deterministic EXIF/ffprobe enrichment
require("../agents/media-hash-agent");   // media_hash — deterministic perceptual hashes
require("../agents/media-visual-agent"); // media_visual_catalog — visual labels/scene + context signals
require("../agents/cluster-agent");      // cluster_media — deterministic grouping
require("../agents/resourceful-file-resolve-agent"); // resourceful_file_resolve — magic-byte + tool-probe unknown file resolver
require("../agents/report-refresh-agent"); // report_refresh — queued per-report refresh runner
require("../agents/quantfusion-trading-agent"); // quant_trading_* autonomous trading ops (paper/live with risk gates)
require("../agents/stub-agents");
require("../agents/content-agent"); // copy_lab_run, copy_research_pack, copy_critique, copy_improve (explicit so ai_worker always has handler)

const { isEmergencyStopped } = require("../control/emergency");

const WORKER_TAGS   = (process.env.WORKER_TAGS || "io_light").split(",").map(s => s.trim());
const WORKER_ID     = `${os.hostname()}-${process.pid}`;
const NODE_ROLE     = process.env.NODE_ROLE || "worker";
let ACTIVE_JOBS = 0;

// ── Tag → queue name map ──────────────────────────────────────────
// NOTE: BullMQ 5.x prohibits colons in queue names.
// Use underscores as separators instead.
const TAG_QUEUES = {
  infra:         ["claw_tasks", "claw_tasks_infra"],
  deterministic: ["claw_tasks_io_heavy"],
  io_heavy:      ["claw_tasks_io_heavy"],
  cpu_heavy:     ["claw_tasks_cpu_heavy"],
  ai:            ["claw_tasks_ai"],
  qa:            ["claw_tasks_qa"],
  // Legacy support
  io_light:   ["claw_tasks", "claw_tasks_io"],
  llm_local:  ["claw_tasks_llm", "claw_tasks_ai"],
  llm_remote: ["claw_tasks_llm", "claw_tasks_ai"],
};

function resolveQueues(tags) {
  const queues = new Set(["claw_tasks"]); // always consume control tasks
  for (const tag of tags) {
    for (const q of TAG_QUEUES[tag] || []) queues.add(q);
  }
  return [...queues];
}

const QUEUES = resolveQueues(WORKER_TAGS);

console.log(`[worker] ID:    ${WORKER_ID}`);
console.log(`[worker] Tags:  ${WORKER_TAGS.join(", ")}`);
console.log(`[worker] Queues: ${QUEUES.join(", ")}`);

// ── Heartbeat ─────────────────────────────────────────────────────
// ── Memory leak threshold ─────────────────────────────────────
// Alert if heap exceeds this. Prevents silent OOM deaths on long-running workers.
const HEAP_WARN_MB = parseInt(process.env.WORKER_HEAP_WARN_MB || "512", 10);
let _heapWarnFired = false;

let _idempotencySchemaEnsured = false;
async function ensureIdempotencySchema() {
  if (_idempotencySchemaEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`).catch(() => {});
  await pg.query(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id               UUID PRIMARY KEY,
      task_id          UUID REFERENCES tasks(id) ON DELETE SET NULL,
      idempotency_key  TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'RUNNING'
                       CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
      worker_id        TEXT,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at     TIMESTAMPTZ,
      result           JSONB,
      error            TEXT
    )
  `).catch(() => {});
  await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_task_runs_idempotency_key ON task_runs (idempotency_key)`).catch(() => {});
  _idempotencySchemaEnsured = true;
}

async function sendHeartbeat() {
  try {
    // Guard: os.loadavg() can return NaN on some macOS states; parseFloat("NaN")
    // throws a Postgres NUMERIC overflow. Cap + NaN-guard here.
    const rawLoad = os.loadavg()[0];
    const load    = (!isFinite(rawLoad) || isNaN(rawLoad))
      ? 0
      : Math.min(parseFloat(rawLoad.toFixed(2)), 99.99); // cap at NUMERIC(4,2)
    const freeMb  = Math.round(os.freemem() / 1024 / 1024);
    const heapMb  = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    await pg.query(
      `INSERT INTO workers
         (worker_id, hostname, tags, node_role, last_seen, load_avg, free_ram_mb)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6)
       ON CONFLICT (worker_id) DO UPDATE SET
         last_seen    = NOW(),
         load_avg     = EXCLUDED.load_avg,
         free_ram_mb  = EXCLUDED.free_ram_mb`,
      [WORKER_ID, os.hostname(), WORKER_TAGS, NODE_ROLE, load, freeMb]
    );

    const ramGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const cpuCores = os.cpus()?.length || null;
    const alwaysOn = ["1", "true", "yes", "on"].includes(String(process.env.WORKER_ALWAYS_ON || "").toLowerCase());

    // Calculate CPU load percentage: (load_avg / cpu_cores) * 100, capped at 100
    const cpuLoadPercent = cpuCores && cpuCores > 0 && isFinite(rawLoad) && !isNaN(rawLoad)
      ? Math.min(parseFloat(((rawLoad / cpuCores) * 100).toFixed(2)), 100)
      : null;

    await pg.query(
      `INSERT INTO device_registry
         (worker_id, hostname, tags, status, ram_gb, cpu_cores, always_on, current_jobs_count, last_heartbeat, capabilities, cpu_load_percent, free_mem_mb, updated_at)
       VALUES ($1,$2,$3,'ready',$4,$5,$6,$7,NOW(),$8::jsonb,$9,$10,NOW())
       ON CONFLICT (worker_id) DO UPDATE SET
         hostname = EXCLUDED.hostname,
         tags = EXCLUDED.tags,
         status = CASE WHEN device_registry.status = 'draining' THEN 'draining' ELSE 'ready' END,
         ram_gb = EXCLUDED.ram_gb,
         cpu_cores = EXCLUDED.cpu_cores,
         always_on = EXCLUDED.always_on,
         current_jobs_count = EXCLUDED.current_jobs_count,
         last_heartbeat = NOW(),
         capabilities = EXCLUDED.capabilities,
         cpu_load_percent = EXCLUDED.cpu_load_percent,
         free_mem_mb = EXCLUDED.free_mem_mb,
         updated_at = NOW()`,
      [
        WORKER_ID,
        os.hostname(),
        WORKER_TAGS,
        ramGb,
        cpuCores,
        alwaysOn,
        ACTIVE_JOBS,
        JSON.stringify({
          node_role: NODE_ROLE,
          queues: QUEUES,
          heap_warn_mb: HEAP_WARN_MB,
          postgres_host: process.env.POSTGRES_HOST || null,
          postgres_db: process.env.POSTGRES_DB || null,
          redis_host: process.env.REDIS_HOST || null,
          redis_port: process.env.REDIS_PORT || null,
          worker_tags: WORKER_TAGS,
        }),
        cpuLoadPercent,
        freeMb,
      ]
    ).catch(() => {});

    // Memory leak detection — log + warn once if heap crosses threshold
    if (heapMb > HEAP_WARN_MB && !_heapWarnFired) {
      _heapWarnFired = true;
      console.error(
        `[memory] ⚠ Heap at ${heapMb}MB (threshold: ${HEAP_WARN_MB}MB) ` +
        `on ${os.hostname()}. Possible leak — consider restarting worker.`
      );
    }
    // Reset flag if memory recovers (GC happened)
    if (heapMb < HEAP_WARN_MB * 0.8) _heapWarnFired = false;

  } catch (err) {
    console.warn("[heartbeat] Failed:", err.message);
  }
}

// ── Job processor ─────────────────────────────────────────────────
async function processJob(job) {
  ACTIVE_JOBS += 1;
  const { id, type, payload, plan_id, workflow_run_id } = job.data;
  const timeoutSeconds = Math.max(60, Number(payload?.timeout_s) || 900);
  const exclusiveKey = resolveExclusiveKey({ type, payload });
  const idempotencyPayload = {
    ...(payload || {}),
    ...(workflow_run_id ? { workflow_run_id } : {}),
  };
  const idempotencyKey = job.data.idempotency_key || buildTaskIdempotencyKey(type, idempotencyPayload);
  let lockToken = null;
  let lockHeartbeat = null;
  let runClaimed = false;
  let signalEmitted = false;

  const emitTaskSignal = async ({ sentiment, errorType = null, priority = "normal", metadata = {} }) => {
    try {
      const entities = [
        `task_type:${type}`,
        plan_id ? `plan:${plan_id}` : null,
        workflow_run_id ? `workflow:${workflow_run_id}` : null,
        payload?.brand_slug ? `brand:${payload.brand_slug}` : null,
      ].filter(Boolean);
      await emitSignal({
        origin_agent_id: `worker:${WORKER_ID}`,
        entities_touched: entities,
        sentiment,
        error_type: errorType,
        metadata: {
          task_id: id,
          task_type: type,
          idempotency_key: idempotencyKey,
          node_role: NODE_ROLE,
          ...metadata,
        },
        priority,
      });
      signalEmitted = true;
    } catch (err) {
      console.warn(`[worker] signal emit failed ${type}:${id.slice(0, 8)} — ${err.message}`);
    }
  };

  if (exclusiveKey) {
    const lock = await acquireExclusiveLock(redis, exclusiveKey, timeoutSeconds, {
      taskId: id,
      workerId: WORKER_ID,
      metadata: { task_type: type, plan_id: plan_id || null, workflow_run_id: workflow_run_id || null },
    });
    if (!lock.acquired) {
      throw new Error(`EXECUTION_ERROR: EXCLUSIVE_LOCK_BUSY (${exclusiveKey})`);
    }
    lockToken = lock.token;
    const heartbeatMs = Math.max(5000, Math.min(30000, Math.floor((timeoutSeconds * 1000) / 3)));
    lockHeartbeat = setInterval(async () => {
      const renewed = await renewExclusiveLock(redis, exclusiveKey, lockToken, timeoutSeconds, {
        taskId: id,
        workerId: WORKER_ID,
        metadata: { task_type: type, plan_id: plan_id || null, workflow_run_id: workflow_run_id || null },
      });
      if (!renewed) {
        console.warn(`[worker] lock lost for ${type}:${id.slice(0, 8)} (${exclusiveKey})`);
      }
    }, heartbeatMs);
    if (typeof lockHeartbeat.unref === "function") lockHeartbeat.unref();
  }

  try {
    // Check emergency stop BEFORE marking running — return job to queue rather than executing
    const emergency = await isEmergencyStopped();
    if (emergency) {
      console.warn(`[worker] ⛔ Emergency stop active — requeuing ${type}:${id.slice(0, 8)}`);
      // Reset to CREATED so dispatcher picks it back up after /resume
      await pg.query(
        `UPDATE tasks SET status = 'CREATED' WHERE id = $1 AND status != 'COMPLETED'`, [id]
      ).catch(() => {});
      throw new Error("Emergency stop active — job requeued");
    }

    // Mark RUNNING
    try {
      validatePayload(type, payload || {});
    } catch (e) {
      const err = new Error(e.message);
      err.code = DLQ_REASON.INVALID_SCHEMA;
      throw err;
    }

    const runState = await claimTaskRun({
      taskId: id,
      idempotencyKey,
      workerId: WORKER_ID,
      timeoutSeconds,
    });

    if (runState.decision === "SKIP_COMPLETED") {
      const reused = runState.result || {};
      await pg.query(
        `UPDATE tasks SET
           status = 'COMPLETED',
           result = $2,
           completed_at = NOW(),
           model_used = COALESCE(model_used, $3),
           cost_usd = COALESCE(cost_usd, $4)
         WHERE id = $1`,
        [id, JSON.stringify(reused), reused?.model_used || null, reused?.cost_usd || 0]
      );
      await queueDependents(id);
      if (plan_id) await retry.updatePlanStatus(plan_id);
      return { skipped: true, reason: "idempotent_completed", idempotency_key: idempotencyKey };
    }

    if (runState.decision === "SKIP_RUNNING") {
      await pg.query(
        `UPDATE tasks
         SET status = 'COMPLETED',
             result = $2,
             completed_at = NOW(),
             last_error = NULL
         WHERE id = $1`,
        [id, JSON.stringify({ skipped: true, reason: "idempotent_in_progress", idempotency_key: idempotencyKey })]
      );
      if (plan_id) await retry.updatePlanStatus(plan_id);
      return { skipped: true, reason: "idempotent_in_progress", idempotency_key: idempotencyKey };
    }

    runClaimed = true;

    const policy = await evaluateTaskPolicyWithExternal({ id, type, payload, plan_id });
    if (!policy.allowed) {
      const err = new Error(`POLICY_BLOCKED: ${policy.reason}`);
      err.code = DLQ_REASON.POLICY_BLOCKED;
      throw err;
    }

    // Mark RUNNING
    await pg.query(
      `UPDATE tasks SET status = 'RUNNING', started_at = NOW() WHERE id = $1`,
      [id]
    );

    const startTime = Date.now();
    const handler   = getHandler(type);

    if (!handler) {
      const err = new Error(`No handler registered for type "${type}"`);
      err.code = DLQ_REASON.INVALID_SCHEMA;
      throw err;
    }

    const result     = await handler(payload);
    const durationMs = Date.now() - startTime;

    // Persist result without follow_up_tasks (control field, not business data)
    const resultForDb = result && Array.isArray(result.follow_up_tasks)
      ? (() => { const { follow_up_tasks, ...rest } = result; return rest; })()
      : result;

    await pg.query(
      `UPDATE tasks SET
         result      = $1,
         duration_ms = $2,
         cost_usd    = $3,
         model_used  = $4,
         status      = 'COMPLETED',
         completed_at = NOW()
       WHERE id = $5`,
      [
        JSON.stringify(resultForDb || {}),
        durationMs,
        result?.cost_usd   || 0,
        result?.model_used || null,
        id
      ]
    );

    await emitTaskSignal({
      sentiment: "positive",
      metadata: {
        duration_ms: durationMs,
        cost_usd: Number(result?.cost_usd || 0),
        model_used: result?.model_used || null,
        has_follow_ups: Array.isArray(result?.follow_up_tasks) && result.follow_up_tasks.length > 0,
      },
      priority: Number(result?.cost_usd || 0) > 1 ? "high" : "normal",
    });

    await completeTaskRun(idempotencyKey, {
      ...(result || {}),
      model_used: result?.model_used || null,
      cost_usd: result?.cost_usd || 0,
    });

    // Unlock dependent tasks
    await queueDependents(id);

    // Handler-spawned follow-up tasks (subagents / minor upgrades)
    const followUps = result?.follow_up_tasks;
    if (plan_id && id && Array.isArray(followUps) && followUps.length > 0) {
      const valid = followUps.filter(
        (item) => item != null && typeof item === "object" && !Array.isArray(item) && typeof item.type === "string"
      );
      if (valid.length > 0) {
        insertFollowUpTasks(plan_id, id, valid).catch((err) => {
          console.error(`[worker] follow_up_tasks insert failed: ${err.message}`);
        });
      }
    }

    if (plan_id) await retry.updatePlanStatus(plan_id);

    // Bump completed counter
    await pg.query(
      `UPDATE workers SET tasks_completed = tasks_completed + 1 WHERE worker_id = $1`,
      [WORKER_ID]
    );

    return result;
  } catch (err) {
    if (!signalEmitted) {
      await emitTaskSignal({
        sentiment: "negative",
        errorType: String(err?.code || "task_error"),
        priority: [DLQ_REASON.POLICY_BLOCKED, DLQ_REASON.INVALID_SCHEMA].includes(err?.code)
          ? "high"
          : "normal",
        metadata: {
          message: String(err?.message || "unknown error").slice(0, 220),
        },
      });
    }
    if (runClaimed) {
      await failTaskRun(idempotencyKey, err.message || String(err)).catch(() => {});
    }
    throw err;
  } finally {
    ACTIVE_JOBS = Math.max(0, ACTIVE_JOBS - 1);
    if (lockHeartbeat) clearInterval(lockHeartbeat);
    if (exclusiveKey && lockToken) {
      await releaseExclusiveLock(redis, exclusiveKey, lockToken);
    }
  }
}

async function queueDependents(completedTaskId) {
  const { rows } = await pg.query(
    `SELECT id, depends_on FROM tasks
     WHERE $1 = ANY(depends_on) AND status = 'PENDING'`,
    [completedTaskId]
  );
  for (const candidate of rows) {
    const { rows: deps } = await pg.query(
      `SELECT id, status FROM tasks WHERE id = ANY($1)`,
      [candidate.depends_on]
    );
    const blocking = deps.filter(d => d.status !== "COMPLETED");
    if (blocking.length === 0) {
      await pg.query(`UPDATE tasks SET status = 'CREATED' WHERE id = $1`, [candidate.id]);
      console.log(`[chain] ↳ Unlocked ${candidate.id.slice(0, 8)}`);
      continue;
    }
    const failedDep = blocking.find(d =>
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
      console.log(`[chain] ⊘ Skipped ${candidate.id.slice(0, 8)} (blocked by ${failedDep.id.slice(0, 8)}:${failedDep.status})`);
    }
  }
}

// ── Concurrency per queue type ────────────────────────────────────
// Override via env: WORKER_CONCURRENCY_AI=2, WORKER_CONCURRENCY_IO_HEAVY=2, etc.
// Or WORKER_CONCURRENCY for a default applied to any queue not explicitly set.
function parseConcurrencyEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

const QUEUE_CONCURRENCY = {
  claw_tasks:         parseConcurrencyEnv("WORKER_CONCURRENCY", 2),
  claw_tasks_infra:   parseConcurrencyEnv("WORKER_CONCURRENCY_INFRA", 2),
  claw_tasks_io:      parseConcurrencyEnv("WORKER_CONCURRENCY_IO", 2),
  claw_tasks_io_heavy:   parseConcurrencyEnv("WORKER_CONCURRENCY_IO_HEAVY", 1),
  claw_tasks_cpu_heavy: parseConcurrencyEnv("WORKER_CONCURRENCY_CPU_HEAVY", 1),
  claw_tasks_ai:      parseConcurrencyEnv("WORKER_CONCURRENCY_AI", 1),
  claw_tasks_llm:     parseConcurrencyEnv("WORKER_CONCURRENCY_LLM", 1),
  claw_tasks_qa:      parseConcurrencyEnv("WORKER_CONCURRENCY_QA", 2),
};

// ── Start workers for each queue ──────────────────────────────────
const _activeWorkers = [];

async function start() {
  const redisStartupTimeoutMs = parseInt(process.env.REDIS_STARTUP_TIMEOUT_MS || "10000", 10);
  await redis.waitForRedisReady(redisStartupTimeoutMs);

  await ensureIdempotencySchema();
  await sendHeartbeat();
  setInterval(sendHeartbeat, 10_000);

  // Optional: for long-running tasks (>30s), set WORKER_LOCK_DURATION_MS and/or WORKER_STALLED_INTERVAL_MS
  // so jobs are not marked stalled. Default lockDuration 30s, stalledInterval 30s.
  const lockDurationMs = parseInt(process.env.WORKER_LOCK_DURATION_MS || "30000", 10);
  const stalledIntervalMs = parseInt(process.env.WORKER_STALLED_INTERVAL_MS || "30000", 10);

  for (const queueName of QUEUES) {
    const concurrency = QUEUE_CONCURRENCY[queueName] ?? 2;
    const worker = new Worker(queueName, processJob, {
      connection:        redis,
      concurrency,
      lockDuration:      lockDurationMs,
      stalledInterval:   stalledIntervalMs,
      // Prevent Redis bloat: keep last 500 completed jobs, last 100 failures.
      removeOnComplete:  { count: 500 },
      removeOnFail:      { count: 100 },
    });

    _activeWorkers.push(worker);

    worker.on("failed", async (job, err) => {
      if (!job?.data?.id) return;
      console.error(`[worker] ✗ ${job.data.type}:${job.data.id.slice(0, 8)} — ${err.message}`);
      if (err?.code === DLQ_REASON.POLICY_BLOCKED || err?.code === DLQ_REASON.INVALID_SCHEMA) {
        await deadLetterTask({
          taskId: job.data.id,
          reasonCode: err.code,
          message: err.message,
        }).catch(() => {});
        if (job.data.plan_id) await retry.updatePlanStatus(job.data.plan_id).catch(() => {});
        return;
      }
      await retry.handleFailure(job.data.id, err).catch(console.error);
      await pg.query(
        `UPDATE workers SET tasks_failed = tasks_failed + 1 WHERE worker_id = $1`,
        [WORKER_ID]
      ).catch(() => {});
    });

    worker.on("error", err => console.error(`[worker:${queueName}] error:`, err.message));

    console.log(`[worker] Listening on: ${queueName} (concurrency=${concurrency})`);
  }

  console.log("[worker] ✅ Ready");
}

// ── Graceful shutdown ─────────────────────────────────────────────
// worker.close() waits for in-flight jobs to finish before exiting.
// This prevents cutting jobs mid-execution on SIGTERM (e.g. pm2 reload).
let _shuttingDown = false;

async function shutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[worker] ${signal} — waiting for in-flight jobs to finish...`);

  try {
    // Deregister from workers table so dispatcher stops routing to us
    await pg.query(`DELETE FROM workers WHERE worker_id = $1`, [WORKER_ID]).catch(() => {});
    await pg.query(
      `UPDATE device_registry
       SET status='offline', last_heartbeat=NOW(), updated_at=NOW()
       WHERE worker_id = $1`,
      [WORKER_ID]
    ).catch(() => {});

    // Close all BullMQ workers gracefully — waits for active jobs
    await Promise.all(_activeWorkers.map(w => w.close()));

    console.log("[worker] All jobs drained. Exiting cleanly.");
  } catch (err) {
    console.error("[worker] Shutdown error:", err.message);
  }

  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT",  () => shutdown("SIGINT"));

start().catch(err => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});

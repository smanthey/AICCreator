"use strict";

// Core Queue module skeleton for OpenClaw.
// Wraps BullMQ/Redis with standardized retry and DLQ behavior.

const { Queue, Worker, QueueScheduler } = require("bullmq");
const { v4: uuidv4 } = require("uuid");
const redis = require("../infra/redis");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const CORE_QUEUE_VERSION = "1.0.0";
const DEFAULT_ACTIVE_TASK_STATUSES = [
  "CREATED",
  "DISPATCHED",
  "RUNNING",
  "RETRY",
  "PENDING_APPROVAL",
  "PENDING",
];
let _routingColsEnsured = false;

// One Queue / QueueScheduler per name (singleton cache, similar to control/dispatcher.js)
const _queues = new Map();
const _schedulers = new Map();

function getOrCreateQueue(name) {
  if (!_queues.has(name)) {
    _queues.set(
      name,
      new Queue(name, {
        connection: redis,
      })
    );
  }
  if (!_schedulers.has(name)) {
    _schedulers.set(
      name,
      new QueueScheduler(name, {
        connection: redis,
      })
    );
  }
  return _queues.get(name);
}

/**
 * Create (or retrieve) a BullMQ Queue by name.
 * @param {string} name
 * @returns {Queue}
 */
function createQueue(name) {
  if (!name) {
    throw new Error("createQueue requires a queue name");
  }
  return getOrCreateQueue(name);
}

/**
 * Create a BullMQ Worker with standardized error handling.
 * The handler is responsible for domain logic; this wrapper only normalizes logging.
 * @param {string} name - queue name
 * @param {Function} handler - async (job) => any
 * @param {object} [options] - BullMQ Worker options
 * @returns {Worker}
 */
function createWorker(name, handler, options) {
  if (!name) {
    throw new Error("createWorker requires a queue name");
  }
  if (typeof handler !== "function") {
    throw new Error("createWorker requires a handler function");
  }

  const workerOptions = {
    connection: redis,
    maxStalledCount: 2,
    stalledInterval: 30_000,
    ...(options || {}),
  };

  const worker = new Worker(
    name,
    async (job) => {
      const startedAt = Date.now();
      try {
        const result = await handler(job);
        const ms = Date.now() - startedAt;
        console.log(
          JSON.stringify({
            module: "core/queue",
            level: "info",
            message: "job_completed",
            queue: name,
            jobId: job.id,
            name: job.name,
            duration_ms: ms,
            version: CORE_QUEUE_VERSION,
          })
        );
        return result;
      } catch (err) {
        const ms = Date.now() - startedAt;
        console.error(
          JSON.stringify({
            module: "core/queue",
            level: "error",
            message: "job_failed",
            queue: name,
            jobId: job.id,
            name: job.name,
            duration_ms: ms,
            version: CORE_QUEUE_VERSION,
            error: err && err.message,
          })
        );
        throw err;
      }
    },
    workerOptions
  );

  worker.on("error", (err) => {
    console.error(
      JSON.stringify({
        module: "core/queue",
        level: "error",
        message: "worker_error",
        queue: name,
        version: CORE_QUEUE_VERSION,
        error: err && err.message,
      })
    );
  });

  worker.on("stalled", (jobId) => {
    console.warn(
      JSON.stringify({
        module: "core/queue",
        level: "warn",
        message: "job_stalled_requeued",
        queue: name,
        jobId,
        maxStalledCount: workerOptions.maxStalledCount,
        stalledIntervalMs: workerOptions.stalledInterval,
        version: CORE_QUEUE_VERSION,
      })
    );
  });

  worker.on("active", (job) => {
    console.log(
      JSON.stringify({
        module: "core/queue",
        level: "info",
        message: "job_active",
        queue: name,
        jobId: job && job.id,
        version: CORE_QUEUE_VERSION,
      })
    );
  });

  return worker;
}

async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function taskExists(idempotencyKey, statuses) {
  const active = Array.isArray(statuses) && statuses.length > 0 ? statuses : DEFAULT_ACTIVE_TASK_STATUSES;
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, active]
  );
  return rows.length > 0;
}

/**
 * Idempotent task creation helper used by scripts/* enqueueTask wrappers.
 * This centralizes payload validation, routing, duplicate checks, and notify behavior.
 *
 * @param {object} options
 * @param {string} options.type
 * @param {object} [options.payload]
 * @param {number} [options.priority]
 * @param {boolean} [options.dryRun]
 * @param {string} [options.idempotencyKey]
 * @param {string[]} [options.activeStatuses]
 * @returns {Promise<object>}
 */
async function enqueueOnce(options) {
  const type = String(options?.type || "").trim();
  const payload = options?.payload || {};
  const dryRun = Boolean(options?.dryRun);
  const priority = Number.isFinite(Number(options?.priority)) ? Number(options.priority) : null;
  const activeStatuses = Array.isArray(options?.activeStatuses) ? options.activeStatuses : DEFAULT_ACTIVE_TASK_STATUSES;

  if (!type) {
    throw new Error("enqueueOnce requires a task type");
  }
  if (!isKnownTaskType(type)) {
    throw new Error(`Unknown task type: ${type}`);
  }
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = String(options?.idempotencyKey || buildTaskIdempotencyKey(type, payload)).trim();
  if (await taskExists(idempotencyKey, activeStatuses)) {
    return { created: false, reason: "duplicate_active", idempotencyKey, type };
  }

  if (dryRun) {
    return { created: true, dry_run: true, type, payload, priority, idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  const payloadJson = JSON.stringify(payload || {});
  const requiresPriority = priority != null;

  if (requiresPriority) {
    await pg.query(
      `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
       VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
      [id, type, payloadJson, priority, routing.queue, routing.required_tags, idempotencyKey]
    );
  } else {
    await pg.query(
      `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
       VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6)`,
      [id, type, payloadJson, routing.queue, routing.required_tags, idempotencyKey]
    );
  }

  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, priority: requiresPriority ? priority : undefined, idempotencyKey };
}

/**
 * Execute fn with exponential backoff and optional jitter. This is the generic
 * retry helper used by other core modules (e.g. core/stripe, core/email).
 *
 * @param {Function} fn - async () => T
 * @param {object} [options]
 * @param {number} [options.maxAttempts=5]
 * @param {number} [options.baseDelayMs=250]
 * @param {Function} [options.shouldRetry] - (error) => boolean
 * @returns {Promise<*>}
 */
async function withRetry(fn, options) {
  if (typeof fn !== "function") {
    throw new Error("withRetry requires a function");
  }

  const maxAttempts = (options && options.maxAttempts) || 5;
  const baseDelayMs = (options && options.baseDelayMs) || 250;
  const shouldRetry =
    (options && options.shouldRetry) ||
    function defaultShouldRetry(err) {
      if (!err || typeof err !== "object") return true;
      const code = err.code || err.statusCode || err.status;
      if (code === 429) return true;
      if (typeof code === "number" && code >= 500) return true;
      return true;
    };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const retryable = attempt < maxAttempts && shouldRetry(err);
      const payload = {
        module: "core/queue",
        level: retryable ? "warn" : "error",
        message: "withRetry_error",
        attempt,
        maxAttempts,
        version: CORE_QUEUE_VERSION,
        error: err && err.message,
      };
      const logger = retryable ? console.warn : console.error;
      logger(JSON.stringify(payload));
      if (!retryable) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
}

exports.CORE_QUEUE_VERSION = CORE_QUEUE_VERSION;
exports.createQueue = createQueue;
exports.createWorker = createWorker;
exports.withRetry = withRetry;
exports.enqueueOnce = enqueueOnce;

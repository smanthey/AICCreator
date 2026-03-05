"use strict";

/**
 * concurrency-cap.js
 *
 * Per-endpoint / per-action concurrency limiting using Redis INCR/DECR.
 * Atomic counter approach avoids the race condition in the existing
 * query-based pattern in architect-api.js (enqueueReportRefresh).
 *
 * Usage — Express middleware factory:
 *   const { capMiddleware } = require("../control/concurrency-cap");
 *
 *   router.post("/api/action/:actionId",
 *     capMiddleware(req => `action:${req.params.actionId}`, 3),
 *     handler
 *   );
 *
 * Usage — standalone async wrapper (non-HTTP context):
 *   const { withCap } = require("../control/concurrency-cap");
 *   await withCap("report:launch_e2e", 2, async () => { ... });
 *
 * Key design decisions:
 *  - Redis INCR is atomic — no TOCTOU race.
 *  - On INCR > limit, we immediately DECR and return 429.
 *  - TTL-based guard: each slot auto-expires (default 15 min) to avoid
 *    leaked counters if a process crashes mid-flight.
 *  - In-process Map fallback if Redis is unavailable (single-node safety net).
 *  - Slot TTL is refreshed on every successful INCR to handle long-running ops.
 */

const redis = require("../infra/redis");

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_PREFIX = "concap:";
const DEFAULT_TTL_SECONDS = 900;  // 15 min — generous for long agent runs
const DEFAULT_RETRY_AFTER = 30;   // seconds hint in 429 Retry-After header

// ─── In-process fallback (used when Redis is down) ────────────────────────────

const _localCounters = new Map(); // key → { count, timers: Set }

function _localIncr(key, ttlSeconds) {
  const slot = _localCounters.get(key) || { count: 0, timers: new Set() };
  slot.count += 1;
  _localCounters.set(key, slot);

  const t = setTimeout(() => {
    const s = _localCounters.get(key);
    if (s) {
      s.count = Math.max(0, s.count - 1);
      s.timers.delete(t);
      if (s.count === 0) _localCounters.delete(key);
    }
  }, ttlSeconds * 1000);

  slot.timers.add(t);
  return slot.count;
}

function _localDecr(key) {
  const slot = _localCounters.get(key);
  if (!slot) return;
  slot.count = Math.max(0, slot.count - 1);
  if (slot.count === 0) _localCounters.delete(key);
}

function _localGet(key) {
  return (_localCounters.get(key) || { count: 0 }).count;
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

// The shared redis client (infra/redis.js) uses maxRetriesPerRequest: null
// (required by BullMQ), meaning commands queue indefinitely when Redis is down.
// We race every Redis op against a short deadline so a disconnected Redis
// doesn't stall HTTP middleware — after REDIS_OP_TIMEOUT_MS we fall through
// to the in-process fallback.
const REDIS_OP_TIMEOUT_MS = 200;

function _withRedisTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("redis_op_timeout")), REDIS_OP_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Atomically increment the counter for `key`.
 * Returns the counter value after increment.
 * If the counter is new, sets a TTL guard so leaked slots eventually expire.
 */
async function _redisIncr(client, key, ttlSeconds) {
  const rk = `${KEY_PREFIX}${key}`;
  const count = await _withRedisTimeout(client.incr(rk));
  // Refresh TTL on every INCR — keeps the slot alive for long-running operations
  // without requiring a separate heartbeat.
  await _withRedisTimeout(client.expire(rk, ttlSeconds));
  return count;
}

async function _redisDecr(client, key) {
  const rk = `${KEY_PREFIX}${key}`;
  const count = await _withRedisTimeout(client.decr(rk));
  // Never go negative — clean up the key if it hits 0.
  if (count <= 0) {
    await _withRedisTimeout(client.del(rk));
  }
}

async function _redisGet(client, key) {
  const rk = `${KEY_PREFIX}${key}`;
  const val = await _withRedisTimeout(client.get(rk));
  return val ? Number(val) : 0;
}

// ─── Core acquire / release ───────────────────────────────────────────────────

/**
 * Try to acquire one slot for `key` up to `limit` concurrent holders.
 *
 * Returns:
 *   { acquired: true,  count: N }   — slot obtained
 *   { acquired: false, count: N }   — limit already reached
 */
async function acquireCap(key, limit, ttlSeconds = DEFAULT_TTL_SECONDS) {
  let client;
  try {
    client = redis.getClient ? redis.getClient() : redis;
  } catch {
    client = null;
  }

  if (client) {
    try {
      const count = await _redisIncr(client, key, ttlSeconds);
      if (count > limit) {
        await _redisDecr(client, key);
        return { acquired: false, count };
      }
      return { acquired: true, count };
    } catch (err) {
      // Redis error — fall through to local fallback
      console.warn(`[concurrency-cap] Redis error for key "${key}", using local fallback: ${err.message}`);
    }
  }

  // In-process fallback
  const count = _localIncr(key, ttlSeconds);
  if (count > limit) {
    _localDecr(key);
    return { acquired: false, count };
  }
  return { acquired: true, count };
}

/**
 * Release one slot for `key`.
 * Always call this in a finally block after acquireCap succeeds.
 */
async function releaseCap(key) {
  let client;
  try {
    client = redis.getClient ? redis.getClient() : redis;
  } catch {
    client = null;
  }

  if (client) {
    try {
      await _redisDecr(client, key);
      return;
    } catch (err) {
      console.warn(`[concurrency-cap] Redis release error for key "${key}": ${err.message}`);
    }
  }

  _localDecr(key);
}

/**
 * Get current concurrency count for `key` (read-only, no side effects).
 */
async function getCap(key) {
  let client;
  try {
    client = redis.getClient ? redis.getClient() : redis;
  } catch {
    client = null;
  }

  if (client) {
    try {
      return await _redisGet(client, key);
    } catch {
      // fall through
    }
  }

  return _localGet(key);
}

// ─── Standalone async wrapper ─────────────────────────────────────────────────

/**
 * withCap(key, limit, fn, [opts])
 *
 * Wraps an async function with a concurrency cap.
 * Throws a ConcurrencyCapError if the limit is already reached.
 *
 * @example
 *   const result = await withCap("report:launch_e2e", 2, () => runReport());
 */
class ConcurrencyCapError extends Error {
  constructor(key, limit, current) {
    super(`Concurrency cap reached for "${key}": limit=${limit} current=${current}`);
    this.name = "ConcurrencyCapError";
    this.key = key;
    this.limit = limit;
    this.current = current;
    this.statusCode = 429;
  }
}

async function withCap(key, limit, fn, opts = {}) {
  const ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
  const { acquired, count } = await acquireCap(key, limit, ttlSeconds);

  if (!acquired) {
    throw new ConcurrencyCapError(key, limit, count);
  }

  try {
    return await fn();
  } finally {
    await releaseCap(key);
  }
}

// ─── Express middleware factory ───────────────────────────────────────────────

/**
 * capMiddleware(keyFn, limit, [opts]) → Express middleware
 *
 * keyFn:  (req) => string  — build a per-request cap key from the request.
 *                            Typical: req => `action:${req.params.actionId}`
 * limit:  number           — max concurrent requests for the derived key
 * opts.ttlSeconds          — slot TTL guard (default 900s)
 * opts.retryAfter          — Retry-After hint in 429 response (default 30s)
 * opts.onCapExceeded       — optional (req, res, key, count) => void override
 *
 * @example
 *   app.post("/api/report/:type",
 *     capMiddleware(req => `report:${req.params.type}`, 3),
 *     reportHandler
 *   );
 *
 *   // Per-user cap:
 *   app.post("/api/generate",
 *     capMiddleware(req => `gen:user:${req.user.id}`, 1),
 *     generateHandler
 *   );
 */
function capMiddleware(keyFn, limit, opts = {}) {
  const ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
  const retryAfter = opts.retryAfter || DEFAULT_RETRY_AFTER;

  return async function concurrencyCapMiddleware(req, res, next) {
    let key;
    try {
      key = typeof keyFn === "function" ? keyFn(req) : String(keyFn);
    } catch (err) {
      // If keyFn throws, skip capping and log
      console.warn(`[concurrency-cap] keyFn threw: ${err.message} — skipping cap`);
      return next();
    }

    const { acquired, count } = await acquireCap(key, limit, ttlSeconds);

    if (!acquired) {
      if (opts.onCapExceeded) {
        return opts.onCapExceeded(req, res, key, count);
      }
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: "too_many_concurrent_requests",
        message: `Too many concurrent requests for this action. Limit is ${limit}. Try again in ${retryAfter}s.`,
        key,
        current: count,
        limit,
      });
    }

    // Release the slot when the response finishes (normal or error path).
    const done = () => releaseCap(key);
    res.on("finish", done);
    res.on("close", done);

    next();
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  acquireCap,
  releaseCap,
  getCap,
  withCap,
  capMiddleware,
  ConcurrencyCapError,
  DEFAULT_TTL_SECONDS,
  DEFAULT_RETRY_AFTER,
};

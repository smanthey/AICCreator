"use strict";

/**
 * replay-hash.js
 *
 * Replay-safe request deduplication using SHA-256 content hashing +
 * PostgreSQL durable response storage.
 *
 * Designed for idempotency of expensive or side-effectful HTTP endpoints:
 * if the same logical request arrives twice within the TTL window, the
 * stored response is returned immediately without re-executing the handler.
 *
 * Key differences from control/idempotency.js (task-level dedup):
 *  - This is HTTP-layer — operates on Express req/res.
 *  - Stores the full serialized response body + status code.
 *  - Uses PostgreSQL for durability across process restarts (no Redis eviction risk).
 *  - Hash covers configurable request fields (method + path + body + optional headers).
 *
 * Usage — Express middleware factory:
 *   const { replayMiddleware } = require("../control/replay-hash");
 *
 *   router.post("/api/action/:actionId",
 *     replayMiddleware({ ttlSeconds: 300 }),
 *     handler
 *   );
 *
 * Usage — standalone:
 *   const { buildRequestHash, lookupReplay, storeReplay } = require("../control/replay-hash");
 *   const hash = buildRequestHash(req, { includeHeaders: ["x-idempotency-key"] });
 *   const cached = await lookupReplay(hash);
 *   if (cached) return res.status(cached.status_code).json(cached.body);
 *   // ... run handler ...
 *   await storeReplay(hash, 200, responseBody, { ttlSeconds: 300 });
 *
 * Schema (auto-created on first use):
 *   CREATE TABLE replay_responses (
 *     hash         TEXT PRIMARY KEY,
 *     status_code  INTEGER NOT NULL,
 *     body         JSONB NOT NULL,
 *     headers      JSONB NOT NULL DEFAULT '{}',
 *     request_info JSONB NOT NULL DEFAULT '{}',
 *     created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     expires_at   TIMESTAMPTZ NOT NULL
 *   );
 */

const crypto = require("crypto");
const pg = require("../infra/postgres");

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 300;   // 5 minutes — safe window for action replays
const HEADER_HASH_KEY = "x-idempotency-key"; // Explicit override key if caller provides one
const SWEEP_INTERVAL_MS = 60_000;  // Sweep expired rows every 60s (lazy GC)
const MAX_BODY_BYTES = 64 * 1024;  // 64 KB — skip caching giant responses

// ─── Schema ───────────────────────────────────────────────────────────────────

let _schemaReady = false;
let _sweepTimer = null;

async function ensureReplaySchema() {
  if (_schemaReady) return;
  await pg.query(`
    CREATE TABLE IF NOT EXISTS replay_responses (
      hash         TEXT PRIMARY KEY,
      status_code  INTEGER NOT NULL,
      body         JSONB NOT NULL,
      headers      JSONB NOT NULL DEFAULT '{}'::jsonb,
      request_info JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at   TIMESTAMPTZ NOT NULL
    )
  `).catch(() => {});
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_replay_responses_expires_at
    ON replay_responses (expires_at)
  `).catch(() => {});
  _schemaReady = true;

  // Start lazy GC sweeper (only one per process)
  if (!_sweepTimer) {
    _sweepTimer = setInterval(sweepExpiredReplays, SWEEP_INTERVAL_MS);
    if (_sweepTimer.unref) _sweepTimer.unref(); // don't block process exit
  }
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Canonicalise a value into a stable string for hashing.
 * Sorts object keys, filters undefined.
 */
function _stableStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return JSON.stringify(v.map(_stableStr));
  const keys = Object.keys(v).sort();
  const out = {};
  for (const k of keys) {
    if (v[k] !== undefined) out[k] = _stableStr(v[k]);
  }
  return JSON.stringify(out);
}

/**
 * buildRequestHash(req, opts)
 *
 * Produces a deterministic SHA-256 hash of the request's logical identity.
 *
 * opts.includeHeaders — array of lowercase header names to include (default: [])
 * opts.ignoreQuery    — bool, if true strips query string from path (default: false)
 * opts.extraFields    — extra key→value pairs to mix in (e.g. { userId: req.user.id })
 *
 * If req.headers["x-idempotency-key"] is set, that value IS the hash (caller-controlled).
 */
function buildRequestHash(req, opts = {}) {
  // Explicit caller-provided idempotency key takes priority
  const explicit = req.headers && req.headers[HEADER_HASH_KEY];
  if (explicit && typeof explicit === "string" && explicit.trim()) {
    return `explicit:${crypto.createHash("sha256").update(explicit.trim()).digest("hex")}`;
  }

  const method = (req.method || "GET").toUpperCase();
  const path = opts.ignoreQuery
    ? (req.path || req.url || "").split("?")[0]
    : (req.path || req.url || "");

  // Body normalisation: use parsed body if available, else raw string
  let bodyStr = "";
  if (req.body !== undefined && req.body !== null) {
    try {
      bodyStr = _stableStr(req.body);
    } catch {
      bodyStr = "";
    }
  }

  const headerParts = {};
  if (Array.isArray(opts.includeHeaders)) {
    for (const h of opts.includeHeaders) {
      const val = req.headers && req.headers[h.toLowerCase()];
      if (val !== undefined) headerParts[h.toLowerCase()] = val;
    }
  }

  const payload = {
    method,
    path,
    body: bodyStr,
    headers: headerParts,
    ...(opts.extraFields || {}),
  };

  return crypto.createHash("sha256").update(_stableStr(payload)).digest("hex");
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * lookupReplay(hash)
 *
 * Returns { status_code, body, headers } if a non-expired entry exists.
 * Returns null if not found or expired.
 */
async function lookupReplay(hash) {
  await ensureReplaySchema();
  try {
    const { rows } = await pg.query(
      `SELECT status_code, body, headers
       FROM replay_responses
       WHERE hash = $1
         AND expires_at > NOW()`,
      [hash]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn(`[replay-hash] lookupReplay failed: ${err.message}`);
    return null;
  }
}

/**
 * storeReplay(hash, statusCode, body, opts)
 *
 * Persists a response so future identical requests can be short-circuited.
 * Upserts — if the same hash arrives again before expiry, we overwrite
 * with the freshest response and reset the TTL.
 *
 * opts.ttlSeconds   — TTL for this entry (default: DEFAULT_TTL_SECONDS)
 * opts.headers      — response headers to store (object, default: {})
 * opts.requestInfo  — loggable request metadata (method, path, etc.)
 */
async function storeReplay(hash, statusCode, body, opts = {}) {
  await ensureReplaySchema();

  const ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
  const headers = opts.headers || {};
  const requestInfo = opts.requestInfo || {};

  // Skip caching if the body is too large
  let bodyStr;
  try {
    bodyStr = JSON.stringify(body);
  } catch {
    bodyStr = "{}";
  }
  if (bodyStr.length > MAX_BODY_BYTES) {
    return false;
  }

  try {
    await pg.query(
      `INSERT INTO replay_responses
         (hash, status_code, body, headers, request_info, created_at, expires_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW(), NOW() + ($6::int * INTERVAL '1 second'))
       ON CONFLICT (hash) DO UPDATE SET
         status_code  = EXCLUDED.status_code,
         body         = EXCLUDED.body,
         headers      = EXCLUDED.headers,
         request_info = EXCLUDED.request_info,
         created_at   = NOW(),
         expires_at   = NOW() + ($6::int * INTERVAL '1 second')`,
      [
        hash,
        statusCode,
        bodyStr,
        JSON.stringify(headers),
        JSON.stringify(requestInfo),
        ttlSeconds,
      ]
    );
    return true;
  } catch (err) {
    console.warn(`[replay-hash] storeReplay failed: ${err.message}`);
    return false;
  }
}

/**
 * sweepExpiredReplays()
 *
 * Deletes expired rows. Called automatically on an interval.
 * Safe to call manually too (e.g. in a nightly maintenance script).
 */
async function sweepExpiredReplays() {
  if (!_schemaReady) return 0;
  try {
    const { rowCount } = await pg.query(
      `DELETE FROM replay_responses WHERE expires_at < NOW()`
    );
    if (rowCount > 0) {
      console.log(`[replay-hash] Swept ${rowCount} expired replay(s)`);
    }
    return rowCount || 0;
  } catch {
    return 0;
  }
}

// ─── Express middleware factory ───────────────────────────────────────────────

/**
 * replayMiddleware(opts) → Express middleware
 *
 * opts.ttlSeconds        — how long to cache the response (default: 300s)
 * opts.includeHeaders    — request header names to include in the hash
 * opts.ignoreQuery       — strip query string from hash path component
 * opts.extraFieldsFn     — (req) => object  extra fields to mix into the hash
 * opts.skipFn            — (req) => bool    return true to bypass replay for this request
 * opts.onReplayHit       — (req, entry) => void  callback on cache hit (for metrics/logging)
 * opts.onReplayMiss      — (req, hash) => void   callback on cache miss
 *
 * How it works:
 *  1. Compute hash of incoming request.
 *  2. If a non-expired entry exists in PostgreSQL → return it immediately (replay).
 *  3. Otherwise, intercept res.json() to capture the response body + status.
 *  4. After the handler sends its response, store the hash + response for future replays.
 *
 * @example
 *   // Cache action POSTs for 5 minutes per actionId
 *   app.post("/api/action/:actionId",
 *     replayMiddleware({
 *       ttlSeconds: 300,
 *       extraFieldsFn: req => ({ actionId: req.params.actionId }),
 *     }),
 *     actionHandler
 *   );
 *
 *   // Allow explicit caller override via header:
 *   //   X-Idempotency-Key: <client-generated-uuid>
 *   app.post("/api/generate",
 *     replayMiddleware({ ttlSeconds: 600 }),
 *     generateHandler
 *   );
 */
function replayMiddleware(opts = {}) {
  const ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;

  return async function replayHashMiddleware(req, res, next) {
    // Allow caller to opt specific requests out
    if (opts.skipFn && opts.skipFn(req)) {
      return next();
    }

    const extraFields = opts.extraFieldsFn ? opts.extraFieldsFn(req) : {};
    const hash = buildRequestHash(req, {
      includeHeaders: opts.includeHeaders || [],
      ignoreQuery: opts.ignoreQuery || false,
      extraFields,
    });

    // ── Replay hit ──────────────────────────────────────────────────────────
    const existing = await lookupReplay(hash);
    if (existing) {
      if (opts.onReplayHit) opts.onReplayHit(req, existing);
      res.set("X-Replay-Hash", hash);
      res.set("X-Replay-Cached", "true");
      return res.status(existing.status_code).json(existing.body);
    }

    if (opts.onReplayMiss) opts.onReplayMiss(req, hash);

    // ── Intercept res.json to capture the response ──────────────────────────
    const _origJson = res.json.bind(res);
    let _captured = false;

    res.json = function interceptedJson(body) {
      if (!_captured) {
        _captured = true;
        const statusCode = res.statusCode || 200;

        // Only cache 2xx responses — don't cache transient errors
        if (statusCode >= 200 && statusCode < 300) {
          const responseHeaders = {
            "content-type": res.get("content-type") || "application/json",
          };
          const requestInfo = {
            method: req.method,
            path: req.path || req.url,
          };
          // Fire-and-forget — don't delay the response
          storeReplay(hash, statusCode, body, {
            ttlSeconds,
            headers: responseHeaders,
            requestInfo,
          }).catch(() => {});
        }

        res.set("X-Replay-Hash", hash);
        res.set("X-Replay-Cached", "false");
      }
      return _origJson(body);
    };

    next();
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  buildRequestHash,
  lookupReplay,
  storeReplay,
  sweepExpiredReplays,
  replayMiddleware,
  DEFAULT_TTL_SECONDS,
};

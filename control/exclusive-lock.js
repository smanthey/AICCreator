"use strict";

const crypto = require("crypto");
const pg = require("../infra/postgres");

const TASK_EXCLUSIVE_KEY = Object.freeze({
  classify: "classify:file_index",
  dedupe: "dedupe:global",
  cluster_media: "cluster_media:file_index",
  migrate: "migrate:vault",
  media_hash: "media_hash:file_index",
  media_enrich: "media_enrich:file_index",
  media_visual_catalog: "media_visual_catalog:file_index",
});

function resolveExclusiveKey(task) {
  const payloadKey = task?.payload?.exclusive_key;
  if (payloadKey && typeof payloadKey === "string" && payloadKey.trim()) {
    return payloadKey.trim();
  }
  return TASK_EXCLUSIVE_KEY[task?.type] || null;
}

let _schemaReady = false;
async function ensureExclusiveLockSchema() {
  if (_schemaReady) return;
  await pg.query(`
    CREATE TABLE IF NOT EXISTS exclusive_locks (
      lock_key       TEXT PRIMARY KEY,
      lock_token     TEXT NOT NULL,
      task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
      worker_id      TEXT,
      ttl_seconds    INTEGER NOT NULL DEFAULT 900,
      acquired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at     TIMESTAMPTZ NOT NULL,
      metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `).catch(() => {});
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_exclusive_locks_expires_at
    ON exclusive_locks (expires_at)
  `).catch(() => {});
  _schemaReady = true;
}

async function upsertLockRecord({ key, token, ttlSeconds, taskId, workerId, metadata }) {
  await pg.query(
    `INSERT INTO exclusive_locks
      (lock_key, lock_token, task_id, worker_id, ttl_seconds, acquired_at, heartbeat_at, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW() + ($5::int * INTERVAL '1 second'), $6::jsonb)
     ON CONFLICT (lock_key)
     DO UPDATE SET
       lock_token = EXCLUDED.lock_token,
       task_id = EXCLUDED.task_id,
       worker_id = EXCLUDED.worker_id,
       ttl_seconds = EXCLUDED.ttl_seconds,
       acquired_at = NOW(),
       heartbeat_at = NOW(),
       expires_at = NOW() + (EXCLUDED.ttl_seconds * INTERVAL '1 second'),
       metadata = EXCLUDED.metadata`,
    [key, token, taskId || null, workerId || null, ttlSeconds, JSON.stringify(metadata || {})]
  ).catch(() => {});
}

async function acquireExclusiveLock(redis, key, ttlSeconds = 900, details = {}) {
  await ensureExclusiveLockSchema();
  const token = crypto.randomUUID();
  const redisKey = `lock:${key}`;

  let ok = await redis.set(redisKey, token, "EX", ttlSeconds, "NX");
  if (ok === "OK") {
    await upsertLockRecord({
      key,
      token,
      ttlSeconds,
      taskId: details.taskId,
      workerId: details.workerId,
      metadata: details.metadata,
    });
    return { acquired: true, token };
  }

  const { rows } = await pg.query(
    `SELECT lock_token, expires_at
     FROM exclusive_locks
     WHERE lock_key = $1`,
    [key]
  ).catch(() => ({ rows: [] }));

  const existing = rows[0];
  if (existing) {
    const stale = await pg.query(
      `SELECT NOW() > $1::timestamptz AS is_stale`,
      [existing.expires_at]
    ).catch(() => ({ rows: [{ is_stale: false }] }));

    if (stale.rows[0]?.is_stale) {
      const cleanupScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        end
        return 0
      `;
      try {
        await redis.eval(cleanupScript, 1, redisKey, existing.lock_token);
      } catch {}
      await pg.query(`DELETE FROM exclusive_locks WHERE lock_key = $1`, [key]).catch(() => {});
      ok = await redis.set(redisKey, token, "EX", ttlSeconds, "NX");
      if (ok === "OK") {
        await upsertLockRecord({
          key,
          token,
          ttlSeconds,
          taskId: details.taskId,
          workerId: details.workerId,
          metadata: details.metadata,
        });
        return { acquired: true, token };
      }
    }
  }

  return { acquired: false, token };
}

async function renewExclusiveLock(redis, key, token, ttlSeconds = 900, details = {}) {
  await ensureExclusiveLockSchema();
  const redisKey = `lock:${key}`;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  let renewed = 0;
  try {
    renewed = await redis.eval(script, 1, redisKey, token, String(ttlSeconds));
  } catch {
    renewed = 0;
  }
  if (!renewed) {
    await pg.query(
      `DELETE FROM exclusive_locks WHERE lock_key = $1 AND lock_token = $2`,
      [key, token]
    ).catch(() => {});
    return false;
  }

  await pg.query(
    `UPDATE exclusive_locks
     SET task_id = COALESCE($3, task_id),
         worker_id = COALESCE($4, worker_id),
         ttl_seconds = $5,
         heartbeat_at = NOW(),
         expires_at = NOW() + ($5::int * INTERVAL '1 second'),
         metadata = COALESCE($6::jsonb, metadata)
     WHERE lock_key = $1
       AND lock_token = $2`,
    [
      key,
      token,
      details.taskId || null,
      details.workerId || null,
      ttlSeconds,
      details.metadata ? JSON.stringify(details.metadata) : null,
    ]
  ).catch(() => {});

  return true;
}

async function releaseExclusiveLock(redis, key, token) {
  await ensureExclusiveLockSchema();
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(script, 1, `lock:${key}`, token);
  } catch {
    // non-fatal
  }
  await pg.query(
    `DELETE FROM exclusive_locks WHERE lock_key = $1 AND lock_token = $2`,
    [key, token]
  ).catch(() => {});
}

async function sweepStaleExclusiveLocks(redis, limit = 200) {
  await ensureExclusiveLockSchema();
  const { rows } = await pg.query(
    `SELECT l.lock_key, l.lock_token, l.task_id, t.status
     FROM exclusive_locks l
     LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.expires_at < NOW()
        OR (t.id IS NOT NULL AND t.status IN ('COMPLETED','DEAD_LETTER','FAILED','SKIPPED','CANCELLED'))
     ORDER BY l.expires_at ASC
     LIMIT $1`,
    [limit]
  ).catch(() => ({ rows: [] }));

  let cleaned = 0;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;

  for (const row of rows) {
    try {
      await redis.eval(script, 1, `lock:${row.lock_key}`, row.lock_token);
    } catch {}
    await pg.query(
      `DELETE FROM exclusive_locks WHERE lock_key = $1 AND lock_token = $2`,
      [row.lock_key, row.lock_token]
    ).catch(() => {});
    cleaned += 1;
  }
  return cleaned;
}

module.exports = {
  resolveExclusiveKey,
  acquireExclusiveLock,
  renewExclusiveLock,
  releaseExclusiveLock,
  sweepStaleExclusiveLocks,
};

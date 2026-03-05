#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const redis = require("../infra/redis");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const DRY_RUN = hasFlag("--dry-run");
const HOSTNAME = getArg("--hostname");
const LIMIT = Math.max(1, Number(getArg("--limit", "2000")) || 2000);
const HASH_LIMIT = Math.max(1, Number(getArg("--hash-limit", String(Math.min(LIMIT * 2, 5000)))) || 5000);
const CLUSTER_LIMIT = Math.max(1, Number(getArg("--cluster-limit", String(Math.min(LIMIT * 2, 50000)))) || 50000);
const CLASSIFY_LIMIT = Math.max(1, Number(getArg("--classify-limit", "2000")) || 2000);
const VISUAL_LIMIT = Math.max(1, Number(getArg("--visual-limit", String(Math.min(CLASSIFY_LIMIT, 5000)))) || 2000);
const LOW_CONFIDENCE = Math.max(0, Math.min(1, Number(getArg("--low-confidence-threshold", "0.7")) || 0.7));
const FORCE = hasFlag("--force");
const ALLOW_OFFLINE = hasFlag("--allow-offline");
const USE_OPENAI_VISION = hasFlag("--use-openai-vision");

async function assertRuntimeReady(tasks) {
  const redisStartupTimeoutMs = parseInt(process.env.REDIS_STARTUP_TIMEOUT_MS || "10000", 10);
  await redis.waitForRedisReady(redisStartupTimeoutMs);
  await redis.ping();

  const requiredGroups = [...new Set(
    tasks
      .map(t => (Array.isArray(t.required_tags) ? [...t.required_tags].sort().join(",") : ""))
      .filter(Boolean)
  )];

  for (const group of requiredGroups) {
    const tags = group.split(",").filter(Boolean);
    const { rows } = await pg.query(
      `SELECT worker_id
       FROM device_registry
       WHERE status IN ('ready','busy')
         AND NOW() - last_heartbeat <= INTERVAL '45 seconds'
         AND tags @> $1::text[]
       LIMIT 1`,
      [tags]
    );
    if (!rows.length) {
      throw new Error(
        `No active worker for required_tags=[${tags.join(",")}]. ` +
        `Start workers and re-run, or pass --allow-offline to queue anyway.`
      );
    }
  }
}

function buildTask(type, payload, dependsOn = []) {
  const id = uuidv4();
  const routing = resolveRouting(type);
  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  return {
    id,
    type,
    payload,
    depends_on: dependsOn,
    status: dependsOn.length ? "PENDING" : "CREATED",
    worker_queue: routing.queue || "claw_tasks",
    required_tags: routing.required_tags || [],
    idempotency_key: idempotencyKey,
  };
}

async function main() {
  const workflowRunId = uuidv4();
  const payloadBase = HOSTNAME ? { hostname: HOSTNAME } : {};

  const detect = buildTask("media_detect", {
    ...payloadBase,
    workflow_run_id: workflowRunId,
    limit: Math.min(CLUSTER_LIMIT, 50000),
  });
  const enrich = buildTask("media_enrich", {
    ...payloadBase,
    workflow_run_id: workflowRunId,
    limit: Math.min(LIMIT, 2000),
    force: FORCE,
    dry_run: DRY_RUN,
  }, [detect.id]);
  const hash = buildTask("media_hash", {
    ...payloadBase,
    workflow_run_id: workflowRunId,
    limit: Math.min(HASH_LIMIT, 5000),
    force: FORCE,
    dry_run: DRY_RUN,
  }, [enrich.id]);
  const cluster = buildTask("cluster_media", {
    ...payloadBase,
    workflow_run_id: workflowRunId,
    limit: Math.min(CLUSTER_LIMIT, 50000),
    force: FORCE,
    dry_run: DRY_RUN,
  }, [hash.id]);
  const classify = buildTask("classify", {
    ...payloadBase,
    workflow_run_id: workflowRunId,
    limit: Math.min(CLASSIFY_LIMIT, 50000),
    low_confidence_threshold: LOW_CONFIDENCE,
    force: FORCE,
  }, [cluster.id]);
  const visual = buildTask("media_visual_catalog", {
    ...payloadBase,
    workflow_run_id: workflowRunId,
    limit: Math.min(VISUAL_LIMIT, 5000),
    force: FORCE,
    dry_run: DRY_RUN,
    use_openai_vision: USE_OPENAI_VISION,
  }, [classify.id]);

  const tasks = [detect, enrich, hash, cluster, classify, visual];
  for (const t of tasks) validatePayload(t.type, t.payload);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] media chain plan:");
    tasks.forEach((t, idx) => {
      console.log(`${idx + 1}. ${t.type}  status=${t.status}  queue=${t.worker_queue}`);
      console.log(`   idempotency_key=${t.idempotency_key}`);
    });
    return;
  }

  if (!ALLOW_OFFLINE) {
    await assertRuntimeReady(tasks);
  }

  const planId = uuidv4();
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO plans (id, goal, raw_plan, status, total_tasks, estimated_cost_usd, model_used, workflow_run_id)
       VALUES ($1, $2, $3::jsonb, 'active', $4, 0, $5, $6)`,
      [
        planId,
        "media_chain deterministic pipeline",
        JSON.stringify({ chain: tasks.map(t => ({ id: t.id, type: t.type, depends_on: t.depends_on })) }),
        tasks.length,
        "deterministic-media-chain",
        workflowRunId,
      ]
    );

    let sequence = 0;
    for (const t of tasks) {
      await client.query(
        `INSERT INTO tasks
           (id, type, payload, status, priority, plan_id, depends_on, depth, sequence, title, worker_queue, required_tags, idempotency_key, workflow_run_id)
         VALUES
           ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          t.id,
          t.type,
          JSON.stringify(t.payload || {}),
          t.status,
          4,
          planId,
          t.depends_on,
          sequence,
          sequence,
          `media chain: ${t.type}`,
          t.worker_queue,
          t.required_tags,
          t.idempotency_key,
          workflowRunId,
        ]
      );
      sequence += 1;
    }

    await client.query("COMMIT");
    await pg.query(`SELECT pg_notify('task_created', $1)`, [planId]).catch(() => {});

    console.log("\n✅ Media chain queued");
    console.log(`Plan ID: ${planId}`);
    console.log(`Workflow Run ID: ${workflowRunId}`);
    tasks.forEach((t, idx) => {
      console.log(`${idx + 1}. ${t.type}  ${t.id}`);
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(async () => {
    await pg.end();
    await redis.quit().catch(() => {});
  })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    await redis.quit().catch(() => {});
    process.exit(1);
  });

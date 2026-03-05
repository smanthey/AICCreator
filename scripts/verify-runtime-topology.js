#!/usr/bin/env node
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f, fallback = null) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : fallback;
};

const STALE_SECONDS = Math.max(10, Number(getArg("--stale-seconds", "45")) || 45);
const REQUIRE_ACTIVE_AI = hasFlag("--require-active-ai");
const STRICT = hasFlag("--strict");
const INCLUDE_DRAINING = hasFlag("--include-draining");

const EXPECTED_POSTGRES = process.env.POSTGRES_HOST || null;
const EXPECTED_REDIS = process.env.REDIS_HOST || null;

function hasAll(tags, required) {
  return required.every((t) => tags.includes(t));
}

function hasAny(tags, forbidden) {
  return forbidden.some((t) => tags.includes(t));
}

async function main() {
  console.log("\n=== Runtime Topology Verification ===\n");
  console.log(`stale threshold: ${STALE_SECONDS}s`);

  const { rows } = await pg.query(
    `SELECT
       worker_id,
       hostname,
       tags,
       status,
       last_heartbeat,
       capabilities->>'node_role'     AS node_role,
       capabilities->>'postgres_host' AS postgres_host,
       capabilities->>'redis_host'    AS redis_host
     FROM device_registry
     WHERE NOW() - last_heartbeat <= ($1::int * INTERVAL '1 second')
       AND status = ANY($2::text[])
     ORDER BY last_heartbeat DESC`,
    [STALE_SECONDS, INCLUDE_DRAINING ? ["ready", "busy", "draining"] : ["ready", "busy"]]
  );

  console.log(`active workers: ${rows.length}`);
  if (!rows.length) {
    console.log("FAIL: no active workers found in device_registry.");
    await pg.end();
    process.exit(1);
  }

  const nasRequired = ["infra", "deterministic", "io_heavy"];
  const nasForbidden = ["ai", "llm_local", "llm_remote"];
  const aiRequired = ["ai"];

  let failures = 0;
  const warn = [];

  const nasWorkers = rows.filter((r) => r.node_role === "nas_worker");
  const aiWorkers = rows.filter((r) => (r.tags || []).includes("ai") || r.node_role === "ai_worker");

  if (!nasWorkers.length) {
    failures++;
    console.log("FAIL: no active nas_worker found.");
  } else {
    for (const w of nasWorkers) {
      const tags = w.tags || [];
      if (!hasAll(tags, nasRequired)) {
        failures++;
        console.log(`FAIL: nas_worker ${w.worker_id} missing required tags ${nasRequired.join(",")} (has: ${tags.join(",")})`);
      }
      if (hasAny(tags, nasForbidden)) {
        failures++;
        console.log(`FAIL: nas_worker ${w.worker_id} has forbidden AI tags (has: ${tags.join(",")})`);
      }
    }
  }

  if (REQUIRE_ACTIVE_AI && !aiWorkers.length) {
    failures++;
    console.log("FAIL: no active AI worker found (required by flag).");
  }

  for (const w of aiWorkers) {
    const tags = w.tags || [];
    if (!hasAll(tags, aiRequired)) {
      failures++;
      console.log(`FAIL: ai worker ${w.worker_id} missing ai tag (has: ${tags.join(",")})`);
    }
    if (w.node_role === "nas_worker") {
      failures++;
      console.log(`FAIL: NAS worker ${w.worker_id} is also AI-capable.`);
    }
  }

  // Require at least one worker to match expected Postgres/Redis so queue and DB are reachable; others warn only
  const postgresMatch = EXPECTED_POSTGRES ? rows.some((w) => w.postgres_host === EXPECTED_POSTGRES) : true;
  const redisMatch = EXPECTED_REDIS ? rows.some((w) => w.redis_host === EXPECTED_REDIS) : true;
  if (EXPECTED_POSTGRES && !postgresMatch) {
    failures++;
    console.log(`FAIL: no worker has postgres_host=${EXPECTED_POSTGRES} (queue/API cannot reach DB)`);
  }
  if (EXPECTED_REDIS && !redisMatch) {
    failures++;
    console.log(`FAIL: no worker has redis_host=${EXPECTED_REDIS} (queue unreachable)`);
  }

  for (const w of rows) {
    if (EXPECTED_POSTGRES && w.postgres_host && w.postgres_host !== EXPECTED_POSTGRES) {
      warn.push(`WARN: worker ${w.worker_id} postgres_host=${w.postgres_host} expected=${EXPECTED_POSTGRES}`);
    } else if (EXPECTED_POSTGRES && !w.postgres_host) {
      warn.push(`WARN: worker ${w.worker_id} has no postgres_host capability snapshot yet`);
    }

    if (EXPECTED_REDIS && w.redis_host && w.redis_host !== EXPECTED_REDIS) {
      warn.push(`WARN: worker ${w.worker_id} redis_host=${w.redis_host} expected=${EXPECTED_REDIS}`);
    } else if (EXPECTED_REDIS && !w.redis_host) {
      warn.push(`WARN: worker ${w.worker_id} has no redis_host capability snapshot yet`);
    }
  }

  if (EXPECTED_POSTGRES || EXPECTED_REDIS) {
    const hasExpectedRoutingWorker = rows.some((w) => {
      const pgOk = !EXPECTED_POSTGRES || w.postgres_host === EXPECTED_POSTGRES;
      const redisOk = !EXPECTED_REDIS || w.redis_host === EXPECTED_REDIS;
      return pgOk && redisOk;
    });
    if (!hasExpectedRoutingWorker) {
      failures++;
      console.log(
        "FAIL: no active worker has expected Postgres+Redis host combination " +
        `(expected pg=${EXPECTED_POSTGRES || "any"}, redis=${EXPECTED_REDIS || "any"}).`
      );
    }
  }

  if (warn.length) {
    for (const w of warn) console.log(w);
    if (STRICT) {
      failures += warn.length;
      console.log("STRICT mode: warnings counted as failures.");
    }
  }

  console.log("\nWorkers:");
  rows.forEach((w) => {
    console.log(
      `- ${w.worker_id} role=${w.node_role || "unknown"} tags=[${(w.tags || []).join(",")}] ` +
      `pg=${w.postgres_host || "?"} redis=${w.redis_host || "?"}`
    );
  });

  await pg.end();
  if (failures > 0) {
    console.log(`\nFAIL: ${failures} topology issue(s) found.`);
    process.exit(1);
  }
  console.log("\nPASS: topology checks passed.");
}

main().catch(async (err) => {
  console.error("FAIL:", err.message);
  try { await pg.end(); } catch {}
  process.exit(1);
});

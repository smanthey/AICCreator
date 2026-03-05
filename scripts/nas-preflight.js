#!/usr/bin/env node
"use strict";

require("dotenv").config();
const net = require("net");
const pg = require("../infra/postgres");
const redis = require("../infra/redis");

const rawOpaUrl = process.env.OPA_URL || "http://127.0.0.1:8181/v1/data/claw/policy";
const OPA_URL = rawOpaUrl.endsWith("/poli")
  ? `${rawOpaUrl}cy`
  : rawOpaUrl;
const OPA_STRICT = String(process.env.POLICY_OPA_STRICT || "false").toLowerCase() === "true";
const REDIS_HOST = process.env.REDIS_HOST;
const isLocalRedisHost = REDIS_HOST === "127.0.0.1" || REDIS_HOST === "localhost";
const rawRedisPort = process.env.REDIS_PORT;
const REDIS_PORT = parseInt(
  (!isLocalRedisHost && (!rawRedisPort || rawRedisPort === "6379"))
    ? "16379"
    : (rawRedisPort || "6379"),
  10
);
const POSTGRES_HOST = process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST;
const POSTGRES_PORT = parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10);

function checkTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ ok, msg });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true, `tcp://${host}:${port} reachable`));
    sock.once("timeout", () => finish(false, `tcp://${host}:${port} timeout`));
    sock.once("error", (e) => finish(false, `tcp://${host}:${port} ${e.code || e.message}`));
    sock.connect(port, host);
  });
}

async function checkOpa() {
  try {
    const res = await fetch(OPA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { type: "media_enrich", payload: {} } }),
    });
    if (!res.ok) return { ok: false, msg: `OPA HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    const allowed = data?.result?.allowed;
    return { ok: true, msg: `OPA reachable (allowed=${String(allowed)})` };
  } catch (e) {
    return { ok: false, msg: `OPA unreachable: ${e.message}` };
  }
}

async function main() {
  console.log("\n=== NAS Preflight ===\n");
  console.log(`POSTGRES: ${POSTGRES_HOST}:${POSTGRES_PORT}`);
  console.log(`REDIS:    ${REDIS_HOST}:${REDIS_PORT}`);
  console.log(`OPA_URL:  ${OPA_URL}\n`);

  const checks = [];

  checks.push(await checkTcp(POSTGRES_HOST, POSTGRES_PORT));
  checks.push(await checkTcp(REDIS_HOST, REDIS_PORT));

  try {
    await pg.query("SELECT 1");
    checks.push({ ok: true, msg: "Postgres query ok" });
  } catch (e) {
    checks.push({ ok: false, msg: `Postgres query failed: ${e.message}` });
  }

  try {
    await redis.waitForRedisReady(parseInt(process.env.REDIS_STARTUP_TIMEOUT_MS || "10000", 10));
    const pong = await redis.ping();
    checks.push({ ok: pong === "PONG", msg: `Redis ping ${pong}` });
  } catch (e) {
    checks.push({ ok: false, msg: `Redis ping failed: ${e.message}` });
  }

  if (String(process.env.POLICY_USE_OPA || "false").toLowerCase() === "true") {
    const opa = await checkOpa();
    if (opa.ok || OPA_STRICT) {
      checks.push(opa);
    } else {
      checks.push({ ok: true, msg: `${opa.msg} (non-blocking, set POLICY_OPA_STRICT=true to enforce)` });
    }
  }

  let fails = 0;
  for (const c of checks) {
    if (c.ok) console.log(`PASS: ${c.msg}`);
    else {
      fails++;
      console.log(`FAIL: ${c.msg}`);
    }
  }

  try { await pg.end(); } catch {}
  try { await redis.quit(); } catch {}

  if (fails > 0) {
    console.log(`\nFAIL: ${fails} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nPASS: NAS preflight complete.");
}

main().catch(async (e) => {
  console.error(`FAIL: ${e.message}`);
  try { await pg.end(); } catch {}
  try { await redis.quit(); } catch {}
  process.exit(1);
});

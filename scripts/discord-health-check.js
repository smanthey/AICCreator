#!/usr/bin/env node
"use strict";

/**
 * discord-health-check.js
 *
 * Verifies the Discord gateway is healthy:
 *   1. Checks that claw-discord-gateway is online in PM2
 *   2. Validates the bot token against Discord's /api/users/@me endpoint
 *   3. Optionally restarts the gateway if unhealthy (DISCORD_HEALTH_RESTART_GATEWAY=true)
 *
 * Used by:
 *   - overnight-self-maintenance.js (step 4: gateway_health_check)
 *   - ecosystem.background.config.js cron every 10 min
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN
 *
 * Optional env vars:
 *   DISCORD_HEALTH_RESTART_GATEWAY   — 'true' to auto-restart on failure (default false)
 *   DISCORD_HEALTH_TIMEOUT_MS        — HTTP timeout in ms (default 7000)
 */

const { execSync } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const TIMEOUT_MS = Math.max(2000, Number(process.env.DISCORD_HEALTH_TIMEOUT_MS || "7000") || 7000);
const RESTART_GATEWAY = String(process.env.DISCORD_HEALTH_RESTART_GATEWAY || "false").toLowerCase() === "true";
const OPTIONAL = String(process.env.DISCORD_OPTIONAL || "true").toLowerCase() === "true";
const GATEWAY_NAME = "claw-discord-gateway";
// Threshold: repeated restarts plus very short uptime signals an active crash loop.
const CRASH_LOOP_RESTART_THRESHOLD = Math.max(1, Number(process.env.DISCORD_HEALTH_MAX_RESTARTS || "3") || 3);
const CRASH_LOOP_MAX_UPTIME_MS = Math.max(
  10_000,
  Number(process.env.DISCORD_HEALTH_CRASH_MAX_UPTIME_MS || "30000") || 30000
);

function fail(msg, code = 1) {
  console.error(`[discord-health] fail: ${msg}`);
  process.exit(code);
}

function pm2Info(name) {
  try {
    const raw = execSync("pm2 jlist", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const list = JSON.parse(raw);
    const found = list.find((p) => p.name === name);
    if (!found) return { status: "missing", restarts: 0, uptime_ms: 0 };
    return {
      status: found.pm2_env?.status || "missing",
      // pm2_env.restart_time is total restarts since pm2 start
      restarts: Number(found.pm2_env?.restart_time || 0),
      // pm_uptime is a unix-epoch ms timestamp for when process last came up
      pm_uptime_epoch_ms: Number(found.pm2_env?.pm_uptime || 0),
    };
  } catch {
    return { status: "unknown", restarts: 0, pm_uptime_epoch_ms: 0 };
  }
}

// Keep backward-compat shim
function pm2Status(name) {
  return pm2Info(name).status;
}

function pm2Restart(name) {
  try {
    execSync(`pm2 restart ${name} --update-env`, { stdio: "inherit" });
    return true;
  } catch (e) {
    return false;
  }
}

async function getJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  return { res, txt, json };
}

async function main() {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  const altToken = String(process.env.DISCORD_TOKEN || "").trim();
  const resolvedToken = token || altToken;
  if (!resolvedToken) {
    if (OPTIONAL) {
      console.log("[discord-health] skip: DISCORD_BOT_TOKEN missing and DISCORD_OPTIONAL=true");
      process.exit(0);
    }
    fail("DISCORD_BOT_TOKEN missing");
  }

  // 1. PM2 process check — status + crash-loop detection (C3 fix)
  const gwInfo = pm2Info(GATEWAY_NAME);
  if (gwInfo.status !== "online") {
    if (RESTART_GATEWAY) {
      console.warn(`[discord-health] gateway status=${gwInfo.status}, attempting restart...`);
      const ok = pm2Restart(GATEWAY_NAME);
      if (!ok) fail(`gateway not online and restart failed`);
      console.log("[discord-health] gateway restarted");
    } else {
      fail(`gateway status=${gwInfo.status}`);
    }
  }

  // Crash-loop detection: only fail when restart count is high AND uptime is still short.
  // This avoids false failures caused by historical restarts after the service stabilizes.
  const uptimeAgeMs = gwInfo.pm_uptime_epoch_ms > 0 ? Math.max(0, Date.now() - gwInfo.pm_uptime_epoch_ms) : 0;
  if (gwInfo.restarts > CRASH_LOOP_RESTART_THRESHOLD && uptimeAgeMs <= CRASH_LOOP_MAX_UPTIME_MS) {
    const msg = `gateway crash-looping: ${gwInfo.restarts} restarts (threshold=${CRASH_LOOP_RESTART_THRESHOLD}) uptimeAgeMs=${uptimeAgeMs}`;
    console.warn(`[discord-health] WARN: ${msg}`);
    if (RESTART_GATEWAY) {
      console.warn("[discord-health] Restarting crash-looping gateway...");
      pm2Restart(GATEWAY_NAME);
    }
    // Exit non-zero so monitoring/sweeps surface the real state
    fail(msg);
  }

  // 2. Discord API token validation
  process.env.DISCORD_BOT_TOKEN = resolvedToken;
  const me = await getJson("https://discord.com/api/v10/users/@me");
  if (!me.res.ok) {
    const detail = me.json?.message || `HTTP ${me.res.status} ${me.txt.slice(0, 120)}`;
    if (RESTART_GATEWAY) {
      console.warn("[discord-health] Discord API check failed, restarting gateway...");
      pm2Restart(GATEWAY_NAME);
    }
    fail(`Discord API /users/@me failed: ${detail}`);
  }

  const botUsername = me.json?.username || "(unknown)";
  const botId = me.json?.id || "(unknown)";
  console.log(`[discord-health] ok bot=${botUsername}#${me.json?.discriminator || "0"} id=${botId} gateway=${gwInfo.status} restarts=${gwInfo.restarts}`);
}

main().catch((err) => fail(err.message));

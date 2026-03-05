#!/usr/bin/env node
"use strict";

const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const TIMEOUT_MS = Math.max(2000, Number(process.env.TELEGRAM_HEALTH_TIMEOUT_MS || "7000") || 7000);
const RESTART_GATEWAY = String(process.env.TELEGRAM_HEALTH_RESTART_GATEWAY || "false").toLowerCase() === "true";
const REQUIRE_OPERATOR_CHAT = String(process.env.TELEGRAM_HEALTH_REQUIRE_OPERATOR_CHAT || "false").toLowerCase() === "true";

function fail(msg, code = 1) {
  console.error(`[telegram-health] fail: ${msg}`);
  process.exit(code);
}

async function pm2Status(name) {
  try {
    const { stdout: raw } = await execAsync("pm2 jlist", { timeout: 8000 });
    const list = JSON.parse(raw);
    const found = list.find((p) => p.name === name);
    return found?.pm2_env?.status || "missing";
  } catch {
    return "unknown";
  }
}

async function getJson(url) {
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) {}
  return { res, txt, json };
}

async function main() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) fail("TELEGRAM_BOT_TOKEN missing");

  const gwStatus = await pm2Status("claw-gateway");
  if (gwStatus !== "online") {
    if (RESTART_GATEWAY) {
      try {
        await execAsync("pm2 restart claw-gateway --update-env", { timeout: 15000 });
      } catch (e) {
        fail(`gateway not online and restart failed: ${e.message}`);
      }
    } else {
      fail(`gateway status=${gwStatus}`);
    }
  }

  const meUrl = `https://api.telegram.org/bot${token}/getMe`;
  const me = await getJson(meUrl);
  if (!me.res.ok || me.json?.ok !== true) {
    const detail = me.json?.description || `${me.res.status} ${me.txt.slice(0, 120)}`;
    if (RESTART_GATEWAY) {
      try { await execAsync("pm2 restart claw-gateway --update-env", { timeout: 15000 }); } catch (_) {}
    }
    fail(`telegram getMe failed: ${detail}`);
  }

  const webhookUrl = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const hook = await getJson(webhookUrl);
  const pending = Number(hook.json?.result?.pending_update_count || 0);
  const lastError = hook.json?.result?.last_error_message || null;

  const opChat = String(process.env.TELEGRAM_OPERATOR_CHAT_ID || "").trim();
  const opChatSet = opChat && !/^PASTE_/i.test(opChat);
  if (REQUIRE_OPERATOR_CHAT && !opChatSet) {
    fail("TELEGRAM_OPERATOR_CHAT_ID not configured");
  }

  const username = me.json?.result?.username || "(no username)";
  const mode = hook.json?.result?.url ? "webhook" : "polling";
  console.log(`[telegram-health] ok bot=@${username} mode=${mode} pending_updates=${pending}${lastError ? ` last_error=${lastError}` : ""}`);
}

main().catch((err) => fail(err.message));

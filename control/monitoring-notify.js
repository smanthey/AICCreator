"use strict";

require("dotenv").config();

// Secret patterns that must never appear in monitoring notifications.
// Covers Anthropic, OpenAI, GitHub, Stripe, generic Bearer/API key prefixes.
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9\-_]{10,}/g,           // Anthropic
  /sk-[A-Za-z0-9]{20,}/g,                   // OpenAI / generic sk-*
  /ghp_[A-Za-z0-9]{36}/g,                   // GitHub personal access tokens
  /github_pat_[A-Za-z0-9_]{82}/g,           // GitHub fine-grained tokens
  /sk_live_[A-Za-z0-9]{24}/g,               // Stripe live secret
  /sk_test_[A-Za-z0-9]{24}/g,               // Stripe test secret
  /rk_live_[A-Za-z0-9]{24}/g,               // Stripe restricted live
  /rk_test_[A-Za-z0-9]{24}/g,               // Stripe restricted test
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/g,      // Generic Bearer tokens
  /[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]["']?\s*[:=]\s*["']?[A-Za-z0-9\-._]{16,}/g, // API key assignments
];

/**
 * Redact known secret patterns from a string before sending to external channels.
 * Replaces matched secrets with a fixed placeholder so the alert is still useful.
 */
function redactSecrets(str) {
  let out = String(str || "");
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function clamp(str, max = 3500) {
  const s = String(str || "");
  return s.length <= max ? s : `${s.slice(0, max - 16)}\n...(truncated)`;
}

// Always redact then clamp — order matters.
function sanitize(str, max = 3500) {
  return clamp(redactSecrets(str), max);
}

async function sendDiscord(text) {
  const webhook = String(process.env.DISCORD_MONITORING_WEBHOOK_URL || "").trim();
  if (!webhook) return { ok: false, skipped: true, channel: "discord" };
  // Discord webhooks accept up to 2000 chars per message
  const content = sanitize(text.replace(/\*/g, "**"), 1990);
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, username: "OpenClaw Monitor" }),
  });
  return { ok: res.ok, skipped: false, channel: "discord", status: res.status };
}

async function sendSlack(text) {
  const webhook = String(process.env.MONITORING_SLACK_WEBHOOK_URL || "").trim();
  if (!webhook) return { ok: false, skipped: true, channel: "slack" };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: sanitize(text, 3500) }),
  });
  return { ok: res.ok, skipped: false, channel: "slack", status: res.status };
}

async function notifyMonitoring(text) {
  const results = [];
  try {
    results.push(await sendDiscord(text));
  } catch (err) {
    results.push({ ok: false, skipped: false, channel: "discord", error: err.message });
  }
  try {
    results.push(await sendSlack(text));
  } catch (err) {
    results.push({ ok: false, skipped: false, channel: "slack", error: err.message });
  }
  const sent = results.some((r) => r.ok === true);
  const configured = results.some((r) => r.skipped === false);
  return { sent, configured, results };
}

module.exports = { notifyMonitoring, redactSecrets };


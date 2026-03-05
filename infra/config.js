// infra/config.js
// Fail-fast startup validation.
// Call validateConfig() as the VERY FIRST thing in any entry point.
// If required env vars are missing, crash immediately with a clear error —
// not 30 seconds later when the first DB query fails.
//
// Usage:
//   require("../infra/config").validateConfig();
//
// The function throws on first missing required var.
// Set NODE_ENV=development to get softer warnings for optional vars.

"use strict";

require("dotenv").config();

// ── Required: system will not function without these ─────────────
const REQUIRED = [
  { key: "POSTGRES_HOST",      desc: "NAS Postgres host (192.168.1.164)" },
  { key: "POSTGRES_PORT",      desc: "NAS Postgres port (15432)" },
  { key: "POSTGRES_USER",      desc: "Postgres user (claw)" },
  { key: "POSTGRES_PASSWORD",  desc: "Postgres password" },
  { key: "POSTGRES_DB",        desc: "Postgres database (claw_architect)" },
  { key: "REDIS_HOST",         desc: "Redis host" },
  { key: "TELEGRAM_BOT_TOKEN", desc: "Telegram bot token — from @BotFather" },
];

// ── Worker-only required (only checked on worker processes) ──────
const REQUIRED_WORKER = [
  { key: "WORKER_TAGS", desc: "Worker capability tags (e.g. io_light,llm_local)" },
];

// ── Optional: warn if missing but don't crash ────────────────────
const OPTIONAL = [
  { key: "ANTHROPIC_API_KEY",      desc: "LLM calls will fail" },
  { key: "OPENAI_API_KEY",         desc: "OpenAI/Codex routes will be skipped" },
  { key: "YOUTUBE_API_KEY",         desc: "fetch_content youtube tasks will fail" },
  { key: "APIFY_API_KEY",           desc: "fetch_content tiktok/instagram tasks will fail" },
  { key: "GOOGLE_PLACES_API_KEY",   desc: "fetch_leads tasks will fail" },
  { key: "BREVO_API_KEY",           desc: "preferred transactional email provider key" },
  { key: "MAILEROO_API_KEY",        desc: "legacy email compatibility key (optional if Brevo/Resend configured)" },
  { key: "RESEND_API_KEY",          desc: "email fallback key (optional)" },
  { key: "GITHUB_TOKEN",            desc: "Private repo github_sync tasks will fail" },
  { key: "DAILY_COST_CAP_USD",      desc: "Defaulting to $20/day" },
  { key: "PLAN_COST_CAP_USD",       desc: "Defaulting to $5/plan" },
  { key: "TELEGRAM_OPERATOR_CHAT_ID", desc: "Dead-letter alerts need this or plan_approvals table" },
];

const NAS_REQUIRED_TAGS = ["infra", "deterministic", "io_heavy"];
const NAS_FORBIDDEN_TAGS = ["ai", "llm_local", "llm_remote"];
const AI_REQUIRED_TAGS = ["ai"];
const AI_FORBIDDEN_TAGS = ["infra", "deterministic"];

function parseTags(raw) {
  return String(raw || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function hasAllTags(tags, required) {
  return required.every(t => tags.includes(t));
}

function hasAnyTag(tags, disallowed) {
  return disallowed.some(t => tags.includes(t));
}

function validateWorkerRoleTagPolicy() {
  const enforce = process.env.WORKER_ENFORCE_ROLE_TAG_POLICY;
  const doEnforce = enforce == null || ["1", "true", "yes", "on"].includes(String(enforce).toLowerCase());
  if (!doEnforce) return;

  const role = process.env.NODE_ROLE || "worker";
  const tags = parseTags(process.env.WORKER_TAGS || "io_light");

  if (role === "nas_worker") {
    if (!hasAllTags(tags, NAS_REQUIRED_TAGS)) {
      throw new Error(
        `[config] nas_worker requires tags: ${NAS_REQUIRED_TAGS.join(",")} (got: ${tags.join(",")})`
      );
    }
    if (hasAnyTag(tags, NAS_FORBIDDEN_TAGS)) {
      throw new Error(
        `[config] nas_worker has forbidden AI tag(s): ${NAS_FORBIDDEN_TAGS.join(",")} (got: ${tags.join(",")})`
      );
    }
  }

  if (role === "ai_worker") {
    if (!hasAllTags(tags, AI_REQUIRED_TAGS)) {
      throw new Error(
        `[config] ai_worker requires tag(s): ${AI_REQUIRED_TAGS.join(",")} (got: ${tags.join(",")})`
      );
    }
    if (hasAnyTag(tags, AI_FORBIDDEN_TAGS)) {
      throw new Error(
        `[config] ai_worker has forbidden infra/deterministic tag(s): ${AI_FORBIDDEN_TAGS.join(",")} (got: ${tags.join(",")})`
      );
    }
  }
}

/**
 * Validates all required environment variables at startup.
 * Throws an Error if any required var is missing or empty.
 * Logs warnings for optional vars.
 *
 * @param {{ worker?: boolean }} opts
 */
function validateConfig({ worker = false } = {}) {
  const missing = [];

  const toCheck = [...REQUIRED, ...(worker ? REQUIRED_WORKER : [])];
  for (const { key, desc } of toCheck) {
    if (!process.env[key] || process.env[key].trim() === "") {
      missing.push(`  ${key.padEnd(30)} — ${desc}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `\n\n❌ ClawdBot startup failed — missing required environment variables:\n\n` +
      missing.join("\n") +
      `\n\nCopy .env.example to .env and fill in the missing values.\n`
    );
  }

  if (worker) {
    validateWorkerRoleTagPolicy();
  }

  // Require at least one remote LLM API key for routed LLM tasks.
  const hasAnyLlmKey = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.DEEPSEEK_API_KEY
  );
  if (!hasAnyLlmKey) {
    console.warn(
      "[config] ⚠ No remote LLM API key set (ANTHROPIC/OPENAI/GEMINI/DEEPSEEK). " +
      "Only subscription/local routes may work."
    );
  }

  // Warn about optional vars only in development
  if (process.env.NODE_ENV !== "production") {
    for (const { key, desc } of OPTIONAL) {
      if (!process.env[key]) {
        console.warn(`[config] ⚠  Optional var ${key} not set — ${desc}`);
      }
    }
  }

  // Extra: validate POSTGRES_HOST is the NAS
  const pgHost = process.env.POSTGRES_HOST;
  if (pgHost && pgHost !== "192.168.1.164" && !pgHost.includes("nas") && !pgHost.includes("localhost")) {
    console.warn(
      `[config] ⚠  POSTGRES_HOST="${pgHost}" — expected NAS at 192.168.1.164. ` +
      `If this is intentional, ignore this warning.`
    );
  }

  const redisHost = process.env.REDIS_HOST;
  if (pgHost && redisHost && pgHost !== redisHost) {
    console.warn(
      `[config] ⚠  POSTGRES_HOST="${pgHost}" and REDIS_HOST="${redisHost}" differ. ` +
      `If you intend a single NAS spine, align both hosts.`
    );
  }

  console.log("[config] ✓ All required environment variables present");
}

/**
 * Returns a config object with typed values and defaults.
 */
function getConfig() {
  return {
    postgres: {
      host:     process.env.POSTGRES_HOST,
      port:     parseInt(process.env.POSTGRES_PORT || "15432", 10),
      user:     process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    },
    redis: {
      host: process.env.REDIS_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    },
    budget: {
      dailyCapUsd: parseFloat(process.env.DAILY_COST_CAP_USD || "20"),
      planCapUsd:  parseFloat(process.env.PLAN_COST_CAP_USD  || "5"),
    },
    telegram: {
      botToken:        process.env.TELEGRAM_BOT_TOKEN,
      operatorChatId:  process.env.TELEGRAM_OPERATOR_CHAT_ID || null,
    },
    worker: {
      tags:     (process.env.WORKER_TAGS || "io_light").split(",").map(s => s.trim()),
      nodeRole: process.env.NODE_ROLE || "worker",
    },
  };
}

module.exports = { validateConfig, getConfig, validateWorkerRoleTagPolicy };

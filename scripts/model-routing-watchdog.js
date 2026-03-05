#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function has(v) {
  return !!String(v || "").trim();
}

function deepseekConfigured() {
  return has(process.env.DEEPSEEK_API_KEY) || has(process.env.DEEPSEEK_KEY);
}

function geminiConfigured() {
  return has(process.env.GEMINI_API_KEY) || has(process.env.GOOGLE_API_KEY) || has(process.env.GOOGLE_GENAI_API_KEY) || has(process.env.GEMINI_KEY);
}

async function todaysProviderErrors() {
  const q = await pg.query(`
    SELECT provider,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE routing_outcome='error')::int AS errors
    FROM model_usage
    WHERE created_at >= date_trunc('day', timezone('UTC', now()))
    GROUP BY provider
  `);

  const out = {};
  for (const r of q.rows || []) {
    const total = n(r.total);
    const errors = n(r.errors);
    out[r.provider] = {
      total,
      errors,
      error_rate: total > 0 ? Number((errors / total).toFixed(4)) : 0,
    };
  }
  return out;
}

async function main() {
  const providerErrors = await todaysProviderErrors();
  const anthropicAllowed = String(process.env.ANTHROPIC_ALLOWED || "true").toLowerCase() === "true";
  const openaiConfigured = has(process.env.OPENAI_API_KEY);

  const issues = [];
  if (!openaiConfigured) issues.push("OPENAI_API_KEY missing (required fallback lane)");
  if (!deepseekConfigured()) issues.push("DeepSeek key missing (set DEEPSEEK_API_KEY or DEEPSEEK_KEY)");
  if (!geminiConfigured()) issues.push("Gemini key missing (set GEMINI_API_KEY or GOOGLE_API_KEY/GOOGLE_GENAI_API_KEY)");
  if (anthropicAllowed) issues.push("ANTHROPIC_ALLOWED=true (set false to minimize Anthropic use)");

  const ollamaErr = providerErrors.ollama?.error_rate || 0;
  if (ollamaErr >= 0.5) {
    issues.push(`High ollama error rate today (${(ollamaErr * 100).toFixed(1)}%) - keep ollama out of enforced fallback`);
  }

  const report = {
    at: new Date().toISOString(),
    mode: "full_throttle_low_anthropic",
    configured: {
      openai: openaiConfigured,
      deepseek: deepseekConfigured(),
      gemini: geminiConfigured(),
      anthropic_allowed: anthropicAllowed,
      model_routing_extra_providers: process.env.MODEL_ROUTING_EXTRA_PROVIDERS || "",
      model_routing_anthropic_last: process.env.MODEL_ROUTING_ANTHROPIC_LAST || "",
    },
    provider_errors_today: providerErrors,
    issues,
    recommended_actions: [
      "Set DEEPSEEK_API_KEY and GEMINI_API_KEY to unlock non-Anthropic high-throughput lanes",
      "Keep ANTHROPIC_ALLOWED=false",
      "Use policy chain openai -> deepseek -> gemini -> anthropic",
    ],
    status: issues.length ? "NEEDS_CONFIG" : "PASS",
  };

  const outDir = path.join(__dirname, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.at.replace(/[:.]/g, "-");
  const latestJson = path.join(outDir, "model-routing-watchdog-latest.json");
  const latestMd = path.join(outDir, "model-routing-watchdog-latest.md");
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2));

  const md = [
    `# Model Routing Watchdog (${report.at})`,
    "",
    `status: **${report.status}**`,
    "",
    "## Config",
    `- openai: ${report.configured.openai}`,
    `- deepseek: ${report.configured.deepseek}`,
    `- gemini: ${report.configured.gemini}`,
    `- anthropic_allowed: ${report.configured.anthropic_allowed}`,
    `- extra providers: ${report.configured.model_routing_extra_providers}`,
    `- anthropic last: ${report.configured.model_routing_anthropic_last}`,
    "",
    "## Issues",
    ...(issues.length ? issues.map((i) => `- ${i}`) : ["- none"]),
  ].join("\n");
  fs.writeFileSync(latestMd, md);
  fs.writeFileSync(path.join(outDir, `model-routing-watchdog-${stamp}.json`), JSON.stringify(report, null, 2));

  console.log(md);
  await pg.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[model-routing-watchdog] fatal:", err.message || String(err));
  try { await pg.end(); } catch (_) {}
  process.exit(1);
});

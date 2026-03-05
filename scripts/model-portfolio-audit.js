#!/usr/bin/env node
"use strict";

require("dotenv").config();

const OLLAMA_HOST_RAW = String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const TIMEOUT_MS = Math.max(2000, Number(process.env.MODEL_PORTFOLIO_TIMEOUT_MS || "25000") || 25000);
const PULL_TIMEOUT_MS = Math.max(120000, Number(process.env.MODEL_PORTFOLIO_PULL_TIMEOUT_MS || "2700000") || 2700000);
const PULL_MISSING = process.argv.includes("--pull-missing");
const PROFILE_ARG_RAW = getArgValue("--profile") || "edge";
const PROFILE_ARG = PROFILE_ARG_RAW.split("|")[0].split(",")[0].trim() || "edge";
const MODELS_ARG = getArgValue("--models");

const PORTFOLIO = [
  { key: "qwen3_32b", env: "OLLAMA_MODEL_QWEN3_32B", fallback: "qwen2.5:14b", lane: "general-high" },
  { key: "qwen3_14b", env: "OLLAMA_MODEL_QWEN3_14B", fallback: "qwen2.5:14b", lane: "general-default" },
  { key: "qwen3_7b", env: "OLLAMA_MODEL_QWEN3_7B", fallback: "llama3.1:8b", lane: "general-medium" },
  { key: "qwen3_1_7b", env: "OLLAMA_MODEL_QWEN3_1_7B", fallback: "llama3.1:8b", lane: "edge-light" },
  { key: "mistral_small_3_2", env: "OLLAMA_MODEL_MISTRAL_SMALL_3_2", fallback: "llama3.1:8b", lane: "general-alt" },
  { key: "deepseek_r1", env: "OLLAMA_MODEL_DEEPSEEK_R1", fallback: "deepseek-r1:8b", lane: "reasoning" },
  { key: "deepseek_v3", env: "OLLAMA_MODEL_DEEPSEEK_V3", fallback: "deepseek-r1:8b", lane: "reasoning-advanced" },
  { key: "llama3_2_3b", env: "OLLAMA_MODEL_LLAMA3_2_3B", fallback: "llama3.1:8b", lane: "edge-light" },
  { key: "gemma_2b", env: "OLLAMA_MODEL_GEMMA_2B", fallback: "llama3.1:8b", lane: "edge-light" },
  { key: "qwen3_coder_30b", env: "OLLAMA_MODEL_QWEN3_CODER_30B", fallback: "qwen2.5-coder:7b", lane: "coding-best" },
  { key: "codestral_22b", env: "OLLAMA_MODEL_CODESTRAL_22B", fallback: "deepseek-coder:6.7b", lane: "coding-best" },
];

const PROFILES = {
  edge: new Set(["qwen3_7b", "qwen3_1_7b", "llama3_2_3b"]),
  balanced: new Set(["qwen3_14b", "deepseek_r1", "qwen3_7b", "llama3_2_3b"]),
  coding: new Set(["qwen3_coder_30b", "codestral_22b", "qwen3_14b", "deepseek_r1"]),
  full: null,
};

function endpoint(path) {
  const host = OLLAMA_HOST_RAW.startsWith("http") ? OLLAMA_HOST_RAW : `http://${OLLAMA_HOST_RAW}`;
  const base = new URL(host);
  return `${base.origin}${path}`;
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || String(next).startsWith("--")) return null;
  return String(next).trim();
}

function selectedSpecs() {
  if (MODELS_ARG) {
    const requested = new Set(MODELS_ARG.split(",").map((s) => s.trim()).filter(Boolean));
    return PORTFOLIO.filter((s) => requested.has(s.key));
  }
  const profile = PROFILES[PROFILE_ARG] ?? PROFILES.full;
  if (!profile) return PORTFOLIO;
  return PORTFOLIO.filter((s) => profile.has(s.key));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${txt.slice(0, 220)}`);
  return json;
}

function resolveTag(spec) {
  return String(process.env[spec.env] || spec.fallback || "").trim();
}

function hasTag(installed, requested) {
  if (!requested) return false;
  if (installed.has(requested)) return true;
  const bare = requested.split(":")[0];
  return installed.has(bare) || installed.has(`${bare}:latest`);
}

async function pullModel(tag) {
  const res = await fetch(endpoint("/api/pull"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, stream: false }),
    signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`pull ${tag} failed: HTTP ${res.status} ${txt.slice(0, 220)}`);
  return txt;
}

async function registryManifestExists(tag) {
  const [name, rawTag] = String(tag || "").split(":");
  const modelName = String(name || "").trim();
  const modelTag = String(rawTag || "latest").trim();
  if (!modelName) return false;
  const url = `https://registry.ollama.ai/v2/library/${encodeURIComponent(modelName)}/manifests/${encodeURIComponent(modelTag)}`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function warmModel(tag) {
  const body = {
    model: tag,
    stream: false,
    messages: [
      { role: "system", content: "Reply with strict JSON only." },
      { role: "user", content: "{\"ok\":true}" },
    ],
    options: { temperature: 0 },
  };
  const out = await fetchJson(endpoint("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return !!(out && (out.message?.content || out.response));
}

async function main() {
  console.log("=== Model Portfolio Audit ===");
  console.log(`ollama_host=${OLLAMA_HOST_RAW}`);
  console.log(`openai_base_url=${OPENAI_BASE_URL}`);
  console.log(`profile=${PROFILE_ARG}${MODELS_ARG ? ` models=${MODELS_ARG}` : ""}`);

  let tags = [];
  try {
    const tagJson = await fetchJson(endpoint("/api/tags"), { method: "GET" });
    tags = (tagJson.models || []).map((m) => String(m.model || m.name || "")).filter(Boolean);
  } catch (err) {
    console.error(`[fail] ollama tags unavailable: ${err.message}`);
    process.exit(1);
  }

  const installed = new Set(tags);
  const rows = [];

  const specs = selectedSpecs();
  if (!specs.length) {
    throw new Error("No models selected by profile/models arguments");
  }

  for (const spec of specs) {
    const requested = resolveTag(spec);
    let present = hasTag(installed, requested);
    let warmed = false;
    let pulled = false;

    if (!present && PULL_MISSING) {
      const exists = await registryManifestExists(requested);
      if (!exists) {
        rows.push({
          lane: spec.lane,
          model: spec.key,
          requested,
          present: "no",
          warm: "no",
          pulled: "skip",
          note: "manifest_missing_registry",
        });
        continue;
      }
      try {
        console.log(`[pull] start ${requested} (${spec.key})`);
        await pullModel(requested);
        console.log(`[pull] done  ${requested} (${spec.key})`);
        pulled = true;
        present = true;
      } catch (err) {
        console.log(`[pull] fail  ${requested} (${spec.key})`);
        rows.push({ lane: spec.lane, model: spec.key, requested, present: "no", warm: "no", pulled: "fail", note: String(err.message).slice(0, 120) });
        continue;
      }
    }

    if (present) {
      try {
        console.log(`[warm] start ${requested} (${spec.key})`);
        warmed = await warmModel(requested);
        console.log(`[warm] ${warmed ? "ok" : "fail"} ${requested} (${spec.key})`);
      } catch (_) {
        warmed = false;
        console.log(`[warm] fail ${requested} (${spec.key})`);
      }
    }

    rows.push({
      lane: spec.lane,
      model: spec.key,
      requested,
      present: present ? "yes" : "no",
      warm: warmed ? "yes" : "no",
      pulled: pulled ? "yes" : "no",
      note: present ? "" : "missing tag",
    });
  }

  console.table(rows);

  const missing = rows.filter((r) => r.present !== "yes").length;
  const cold = rows.filter((r) => r.present === "yes" && r.warm !== "yes").length;
  console.log(`summary: total=${rows.length} missing=${missing} present_not_warm=${cold}`);

  if (missing > 0) {
    console.log("hint: run one profile at a time, e.g. `npm run model:portfolio -- --profile edge --pull-missing`");
    console.log("hint: valid profiles are `edge`, `balanced`, `coding`, `full`");
  }
}

main().catch((err) => {
  console.error(`[model-portfolio-audit] fatal: ${err.message}`);
  process.exit(1);
});

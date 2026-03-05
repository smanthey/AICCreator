"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const pg = require("./postgres");
const { normalizeConfidence, parseMaybeJson } = require("./confidence");

let _redis = null;
try { _redis = require("./redis"); } catch (_) {}

const ROUTER_POLICY_ENFORCE = envBool("ROUTER_POLICY_ENFORCE", true);
const ROUTER_BUDGET_HARD_BLOCK = envBool("ROUTER_BUDGET_HARD_BLOCK", true);
const ROUTER_CONFIDENCE_ENFORCE = envBool("ROUTER_CONFIDENCE_ENFORCE", true);

const MODEL_CONFIDENCE_THRESHOLD = toFloat(process.env.MODEL_CONFIDENCE_THRESHOLD, 0.72);
const MODEL_CACHE_TTL_SEC = Math.max(0, toInt(process.env.MODEL_CACHE_TTL_SEC, 900));
const MODEL_BUDGET_REFRESH_MS = Math.max(5000, toInt(process.env.MODEL_BUDGET_REFRESH_MS, 30000));

const LLM_DAILY_BUDGET_USD = toFloat(process.env.LLM_DAILY_BUDGET_USD, 25);
const OPENAI_DAILY_BUDGET_USD = toFloat(process.env.OPENAI_DAILY_BUDGET_USD, 10);
const OPENAI_CODEX_DAILY_BUDGET_USD = toFloat(process.env.OPENAI_CODEX_DAILY_BUDGET_USD, 3);
const DEEPSEEK_DAILY_BUDGET_USD = toFloat(process.env.DEEPSEEK_DAILY_BUDGET_USD, 8);
const GEMINI_DAILY_BUDGET_USD = toFloat(process.env.GEMINI_DAILY_BUDGET_USD, 8);
const ANTHROPIC_DAILY_BUDGET_USD = toFloat(process.env.ANTHROPIC_DAILY_BUDGET_USD, 12);
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
const GEMINI_BASE_URL = String(process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const ANTHROPIC_ALLOWED = envBool("ANTHROPIC_ALLOWED", true);
const MODEL_ROUTING_ANTHROPIC_LAST = envBool("MODEL_ROUTING_ANTHROPIC_LAST", true);
const MODEL_ROUTING_EXTRA_PROVIDERS = String(process.env.MODEL_ROUTING_EXTRA_PROVIDERS || "deepseek,gemini")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

const POLICY_PATH = path.join(__dirname, "..", "config", "model-routing-policy.json");
const SHARED_INDEX_KNOWLEDGE_PATH = path.join(__dirname, "..", "reports", "index-knowledge-latest.json");
const SHARED_SYMBOLIC_PATH = path.join(__dirname, "..", "reports", "symbolic-qa-hub-latest.json");
const SHARED_REPOMAP_PATH = path.join(__dirname, "..", "reports", "repomap-background-latest.json");
const OLLAMA_INDEX_CONTEXT_ENABLED = envBool("OLLAMA_INDEX_CONTEXT_ENABLED", true);
const OLLAMA_INDEX_CONTEXT_MAX_CHARS = Math.max(400, toInt(process.env.OLLAMA_INDEX_CONTEXT_MAX_CHARS, 2200));
const OLLAMA_INDEX_CONTEXT_CACHE_MS = Math.max(5000, toInt(process.env.OLLAMA_INDEX_CONTEXT_CACHE_MS, 120000));

// Keep backward compatibility with existing model keys.
const MODELS = {
  ollama_llama3: { provider: "ollama", model: process.env.OLLAMA_MODEL_FAST || process.env.OLLAMA_CLASSIFY_MODEL || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  ollama_qwen3_32b: { provider: "ollama", model: process.env.OLLAMA_MODEL_QWEN3_32B || "qwen2.5:14b", label: "Ollama/Qwen2.5-14B", cost_per_1k: [0, 0] },
  ollama_qwen3_14b: { provider: "ollama", model: process.env.OLLAMA_MODEL_QWEN3_14B || "qwen2.5:14b", label: "Ollama/Qwen2.5-14B", cost_per_1k: [0, 0] },
  ollama_qwen3_7b: { provider: "ollama", model: process.env.OLLAMA_MODEL_QWEN3_7B || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  ollama_qwen3_4b: { provider: "ollama", model: process.env.OLLAMA_MODEL_QWEN3_4B || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  ollama_qwen3_1_7b: { provider: "ollama", model: process.env.OLLAMA_MODEL_QWEN3_1_7B || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  ollama_qwen3_coder_30b: { provider: "ollama", model: process.env.OLLAMA_MODEL_QWEN3_CODER_30B || "qwen2.5-coder:7b", label: "Ollama/Qwen2.5-Coder-7B", cost_per_1k: [0, 0] },
  ollama_codestral_22b: { provider: "ollama", model: process.env.OLLAMA_MODEL_CODESTRAL_22B || "deepseek-coder:6.7b", label: "Ollama/DeepSeek-Coder-6.7B", cost_per_1k: [0, 0] },
  ollama_mistral_small_3_2: { provider: "ollama", model: process.env.OLLAMA_MODEL_MISTRAL_SMALL_3_2 || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  ollama_deepseek_r1: { provider: "ollama", model: process.env.OLLAMA_MODEL_DEEPSEEK_R1 || "deepseek-r1:8b", label: "Ollama/DeepSeek-R1-8B", cost_per_1k: [0, 0] },
  ollama_deepseek_v3: { provider: "ollama", model: process.env.OLLAMA_MODEL_DEEPSEEK_V3 || "deepseek-r1:8b", label: "Ollama/DeepSeek-R1-8B", cost_per_1k: [0, 0] },
  ollama_llama3_2_3b: { provider: "ollama", model: process.env.OLLAMA_MODEL_LLAMA3_2_3B || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  ollama_gemma_2b: { provider: "ollama", model: process.env.OLLAMA_MODEL_GEMMA_2B || "llama3.1:8b", label: "Ollama/Llama-3.1-8B", cost_per_1k: [0, 0] },
  openai_mini: { provider: "openai", model: process.env.OPENAI_MODEL_FAST || "gpt-4o-mini", label: "OpenAI/Mini", cost_per_1k: [0.00015, 0.0006] },
  openai_codex: { provider: "openai", model: process.env.OPENAI_MODEL_CODEX || "gpt-4o", label: "OpenAI/Codex", cost_per_1k: [0.002, 0.008] },
  openai_qwen35: {
    provider: "openai",
    model: process.env.OPENAI_MODEL_QWEN35 || process.env.QWEN35_MODEL || "qwen3.5-72b-instruct",
    label: "OpenAI-Compatible/Qwen3.5",
    cost_per_1k: [0.0003, 0.0012],
  },
  deepseek_chat: {
    provider: "deepseek",
    model: process.env.DEEPSEEK_MODEL_FAST || "deepseek-chat",
    label: "DeepSeek/Chat",
    cost_per_1k: [0.00014, 0.00028],
  },
  deepseek_reasoner: {
    provider: "deepseek",
    model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-reasoner",
    label: "DeepSeek/Reasoner",
    cost_per_1k: [0.00055, 0.0022],
  },
  gemini_flash: {
    provider: "gemini",
    model: process.env.GEMINI_MODEL_FAST || "gemini-2.0-flash",
    label: "Gemini/Flash",
    cost_per_1k: [0.000075, 0.0003],
  },
  gemini_pro: {
    provider: "gemini",
    model: process.env.GEMINI_MODEL_PRO || "gemini-2.5-pro",
    label: "Gemini/Pro",
    cost_per_1k: [0.00125, 0.005],
  },
  api_haiku: {
    provider: "anthropic",
    // Keep defaults aligned with currently active Anthropic model IDs.
    model: process.env.ANTHROPIC_MODEL_HAIKU || process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5-20251001",
    label: "Anthropic/Fast",
    cost_per_1k: [0.00025, 0.00125],
  },
  api_sonnet: { provider: "anthropic", model: process.env.ANTHROPIC_MODEL_SONNET || "claude-sonnet-4-6", label: "Anthropic/Sonnet", cost_per_1k: [0.003, 0.015] },
  api_opus: { provider: "anthropic", model: process.env.ANTHROPIC_MODEL_OPUS || "claude-opus-4-6", label: "Anthropic/Opus", cost_per_1k: [0.015, 0.075] },
};

const PROVIDER_MODEL_PREFS = {
  ollama: [
    "ollama_qwen3_14b",
    "ollama_deepseek_r1",
    "ollama_llama3",
    "ollama_qwen3_7b",
    "ollama_qwen3_coder_30b",
  ],
  openai: ["openai_mini"],
  deepseek: ["deepseek_chat", "deepseek_reasoner"],
  gemini: ["gemini_flash", "gemini_pro"],
  anthropic: ["api_haiku", "api_sonnet", "api_opus"],
};

const TASK_MODEL_OVERRIDES = {
  patch: { deepseek: "deepseek_reasoner", openai: "openai_codex", anthropic: "api_sonnet" },
  orchestrate: { deepseek: "deepseek_reasoner", openai: "openai_codex", anthropic: "api_opus" },
  plan: { deepseek: "deepseek_reasoner", openai: "openai_codex", anthropic: "api_sonnet" },
  qa_spec: { ollama: "ollama_qwen3_coder_30b", deepseek: "deepseek_reasoner", openai: "openai_codex", anthropic: "api_sonnet" },
  judge: { ollama: "ollama_deepseek_r1", deepseek: "deepseek_reasoner", gemini: "gemini_flash", openai: "openai_mini", anthropic: "api_haiku" },
  triage: { ollama: "ollama_deepseek_r1", deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_mini", anthropic: "api_haiku" },
  classify: { ollama: "ollama_llama3", deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_mini", anthropic: "api_haiku" },
  analyze_content: { ollama: "ollama_qwen3_14b", deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  site_audit: { deepseek: "deepseek_reasoner", gemini: "gemini_pro", openai: "openai_codex", anthropic: "api_sonnet" },
  site_fix_plan: { deepseek: "deepseek_reasoner", gemini: "gemini_pro", openai: "openai_codex", anthropic: "api_sonnet" },
  site_extract_patterns: { deepseek: "deepseek_chat", gemini: "gemini_flash", anthropic: "api_sonnet" },
  copy_research_pack: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  copy_critique: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  copy_improve: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  copy_lab_run: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  website_content_generator: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  social_media_copywriter: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  generate_copy: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
  aicreator: { deepseek: "deepseek_chat", gemini: "gemini_flash", openai: "openai_qwen35", anthropic: "api_sonnet" },
};

const AI_TASK_TYPES = new Set([
  "classify", "triage", "judge", "patch", "plan", "orchestrate",
  "analyze_content", "generate_copy", "aicreator",
  "copy_research_pack", "copy_critique", "copy_improve", "copy_lab_run",
  "website_content_generator", "social_media_copywriter",
  "site_audit", "site_compare", "site_fix_plan", "site_extract_patterns",
  "_default",
]);

const telemetry = {
  routing_primary_selected: 0,
  routing_fallback_invoked: 0,
  routing_fallback_reason: Object.create(null),
  routing_budget_blocked: 0,
  routing_low_confidence_count: 0,
  routing_provider_error_rate: Object.create(null),
};

const REDIS_RL_PREFIX = "model_router:rl:";
const RL_TTL_SEC = 300;

let _budgetSnapshot = { at: 0, total: 0, openai: 0, codex: 0, anthropic: 0 };
let _routingPolicy = null;
let _policyMtimeMs = 0;
let _sharedIndexCache = { at: 0, snippet: "" };

const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

function deepseekApiKey() {
  return String(
    process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_KEY ||
    ""
  ).trim();
}

function geminiApiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_KEY ||
    ""
  ).trim();
}

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function toInt(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(v, fallback) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHttpHost(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : `http://${s.replace(/\/+$/, "")}`;
}

function ollamaHosts() {
  const explicit = String(process.env.OLLAMA_HOSTS || "")
    .split(",")
    .map((x) => normalizeHttpHost(x))
    .filter(Boolean);
  const primary = normalizeHttpHost(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
  const hosts = [...new Set([primary, ...explicit].filter(Boolean))];
  if (!hosts.length) return ["http://127.0.0.1:11434"];

  // Optional: prioritize non-local hosts first to increase M1/M3 utilization.
  const remoteFirst = envBool("OLLAMA_REMOTE_FIRST", false);
  if (!remoteFirst) return hosts;
  return hosts.sort((a, b) => {
    const aLocal = /127\.0\.0\.1|localhost/i.test(a) ? 1 : 0;
    const bLocal = /127\.0\.0\.1|localhost/i.test(b) ? 1 : 0;
    return aLocal - bLocal;
  });
}

function stableHostStartIndex(taskType, userMsg, opts, size) {
  const seed = `${taskType}|${opts?.task_id || ""}|${opts?.plan_id || ""}|${String(userMsg || "").slice(0, 120)}`;
  const d = crypto.createHash("sha1").update(seed).digest("hex");
  return parseInt(d.slice(0, 8), 16) % Math.max(1, size);
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonFileSafe(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function clampText(s, maxChars) {
  const raw = String(s || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length <= maxChars ? raw : `${raw.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isValidImageDataUrl(url) {
  const m = String(url || "").match(/^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return false;
  try {
    return Buffer.from(m[1], "base64").length > 0;
  } catch {
    return false;
  }
}

function sanitizeMultimodalContent(content) {
  if (!Array.isArray(content)) return content;
  const cleaned = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "image_url") {
      if (isValidImageDataUrl(part?.image_url?.url)) cleaned.push(part);
      continue;
    }
    cleaned.push(part);
  }
  if (cleaned.length === 0) return "";
  return cleaned;
}

function buildSharedIndexSnippet() {
  const direct = readJsonFileSafe(SHARED_INDEX_KNOWLEDGE_PATH);
  if (direct && typeof direct === "object") {
    const weakest = Array.isArray(direct?.readiness?.weakest_repos) ? direct.readiness.weakest_repos.slice(0, 6) : [];
    const features = Array.isArray(direct?.symbolic_qa?.top_features) ? direct.symbolic_qa.top_features.slice(0, 4) : [];
    const lines = [];
    lines.push(`index_generated_at=${direct.generated_at || "unknown"}`);
    lines.push(
      `symbolic_indexed=${Number(direct?.symbolic_qa?.repos_indexed || 0)}/${Number(direct?.symbolic_qa?.repos_total || 0)} ` +
      `repomap_repos=${Number(direct?.repomap?.repos_total || 0)} readiness_below_threshold=${Number(direct?.readiness?.below_threshold || 0)}`
    );
    if (weakest.length) {
      lines.push(
        `weakest_repos=${weakest.map((r) => `${r.repo}:${Number(r.total_score || 0)}`).join(", ")}`
      );
    }
    if (features.length) {
      const featureBits = features.map((f) => {
        const top = Array.isArray(f.top_symbols) ? f.top_symbols.slice(0, 2).map((s) => s.symbol_id).filter(Boolean).join(" | ") : "";
        return `${f.key}${top ? `=>${top}` : ""}`;
      });
      lines.push(`top_features=${featureBits.join(" ; ")}`);
    }
    return clampText(lines.join("\n"), OLLAMA_INDEX_CONTEXT_MAX_CHARS);
  }

  const symbolic = readJsonFileSafe(SHARED_SYMBOLIC_PATH) || {};
  const repomap = readJsonFileSafe(SHARED_REPOMAP_PATH) || {};
  const topFeature = Array.isArray(symbolic.features) ? symbolic.features[0] : null;
  const topSymbols = Array.isArray(topFeature?.top_symbols)
    ? topFeature.top_symbols.slice(0, 3).map((s) => s.symbol_id).filter(Boolean)
    : [];
  const lines = [
    `symbolic_generated_at=${symbolic.generated_at || "unknown"}`,
    `symbolic_indexed=${Number(symbolic.repos_indexed || 0)}/${Number(symbolic.repos_total || 0)} repomap_repos=${Array.isArray(repomap.repos) ? repomap.repos.length : 0}`,
    `feature_hint=${topFeature?.feature_key || "none"} symbols=${topSymbols.join(" | ") || "none"}`,
  ];
  return clampText(lines.join("\n"), OLLAMA_INDEX_CONTEXT_MAX_CHARS);
}

function sharedIndexSnippet() {
  const now = Date.now();
  if (_sharedIndexCache.snippet && (now - _sharedIndexCache.at) < OLLAMA_INDEX_CONTEXT_CACHE_MS) {
    return _sharedIndexCache.snippet;
  }
  const snippet = buildSharedIndexSnippet();
  _sharedIndexCache = { at: now, snippet };
  return snippet;
}

function incCounter(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function normalizeEscalationReason(reason) {
  return reason || "policy";
}

function loadRoutingPolicy(force = false) {
  let stat;
  try {
    stat = fs.statSync(POLICY_PATH);
  } catch (err) {
    throw new Error(`model-routing policy missing: ${POLICY_PATH}`);
  }

  if (!force && _routingPolicy && stat.mtimeMs === _policyMtimeMs) {
    return _routingPolicy;
  }

  const raw = fs.readFileSync(POLICY_PATH, "utf8");
  const parsed = JSON.parse(raw);
  validateRoutingPolicy(parsed);

  _routingPolicy = parsed;
  _policyMtimeMs = stat.mtimeMs;
  return _routingPolicy;
}

function validateRoutingPolicy(policy) {
  if (!policy || typeof policy !== "object") {
    throw new Error("model-routing policy invalid: not an object");
  }
  if (!policy.default || typeof policy.default !== "object") {
    throw new Error("model-routing policy invalid: missing default policy");
  }
  const required = [
    "primary_provider",
    "fallback_chain",
    "max_latency_ms",
    "min_confidence",
    "json_required",
    "max_retries_per_provider",
    "budget_class",
    "cache_ttl_sec",
  ];

  const taskPolicies = policy.task_policies || {};
  for (const [taskType, p] of Object.entries(taskPolicies)) {
    for (const key of required) {
      if (!(key in p)) {
        throw new Error(`model-routing policy invalid: task ${taskType} missing ${key}`);
      }
    }
  }

  if (!ROUTER_POLICY_ENFORCE) return;

  for (const taskType of AI_TASK_TYPES) {
    if (taskType === "_default") continue;
    if (!taskPolicies[taskType]) {
      throw new Error(`model-routing policy missing required AI task policy: ${taskType}`);
    }
  }
}

function policyForTask(taskType, opts = {}) {
  const policy = loadRoutingPolicy();
  const base = { ...policy.default };
  const override = policy.task_policies?.[taskType] || {};
  const merged = { ...base, ...override };

  if (opts.json_mode === true) merged.json_required = true;
  if (opts.max_latency_ms) merged.max_latency_ms = opts.max_latency_ms;
  if (opts.min_confidence != null) merged.min_confidence = Number(opts.min_confidence);
  if (opts.cache_ttl_sec != null) merged.cache_ttl_sec = Number(opts.cache_ttl_sec);
  if (opts.cacheable != null) merged.cacheable = !!opts.cacheable;

  if (typeof merged.min_confidence !== "number" || !Number.isFinite(merged.min_confidence)) {
    merged.min_confidence = MODEL_CONFIDENCE_THRESHOLD;
  }

  return merged;
}

function providerChainForTask(taskType, policy, opts = {}) {
  let providers = [policy.primary_provider, ...(policy.fallback_chain || [])]
    .map((p) => String(p || "").trim().toLowerCase())
    .filter(Boolean);

  if (MODEL_ROUTING_EXTRA_PROVIDERS.length) {
    for (const p of MODEL_ROUTING_EXTRA_PROVIDERS) {
      if (!providers.includes(p)) providers.push(p);
    }
  }

  if (MODEL_ROUTING_ANTHROPIC_LAST && providers.includes("anthropic")) {
    providers = providers.filter((p) => p !== "anthropic");
    providers.push("anthropic");
  }

  // Dynamic Budget Throttling: Degraded Operation Mode
  // If at 90% of daily budget, force all tasks to Ollama (free compute) regardless of primary provider
  // This is an autonomous improvement to prevent budget overruns
  if (opts.budget_snapshot && typeof opts.budget_snapshot === "object") {
    const snapshot = opts.budget_snapshot;
    const budgetRatio = snapshot.total / LLM_DAILY_BUDGET_USD;
    const DEGRADED_THRESHOLD = 0.9; // 90% threshold

    if (budgetRatio >= DEGRADED_THRESHOLD && !opts.force_model) {
      // Force Ollama-only mode for degraded operation
      // Only allow critical tasks to bypass (they already have approval_token checks)
      if (!policy.critical || !opts.approval_token) {
        providers = providers.filter((p) => p === "ollama");
        if (providers.length === 0) {
          // Fallback: ensure Ollama is available
          providers = ["ollama"];
        }
        // Log degraded mode activation (non-blocking)
        if (!opts._degraded_logged) {
          console.warn(
            `[model-router] 🚨 Degraded Operation Mode: ${(budgetRatio * 100).toFixed(1)}% budget used, ` +
            `forcing Ollama-only routing for non-critical tasks`
          );
          opts._degraded_logged = true;
        }
      }
    }
  }

  if (opts.force_model) {
    const forcedDef = MODELS[opts.force_model];
    if (!forcedDef) {
      throw new Error(`Unknown force_model: ${opts.force_model}`);
    }
    return [{ provider: forcedDef.provider, model_key: opts.force_model, forced: true }];
  }

  const out = [];
  for (const provider of providers) {
    const overrideModel = TASK_MODEL_OVERRIDES[taskType]?.[provider];
    if (overrideModel) {
      out.push({ provider, model_key: overrideModel });
      continue;
    }
    const defaultModels = PROVIDER_MODEL_PREFS[provider] || [];
    for (const mk of defaultModels) out.push({ provider, model_key: mk });
  }

  // Deduplicate model keys while preserving order.
  const seen = new Set();
  return out.filter((x) => {
    if (!x.model_key || seen.has(x.model_key)) return false;
    seen.add(x.model_key);
    return true;
  });
}

function cacheKey(taskType, modelKey, systemPrompt, userMsg, opts = {}) {
  const payload = JSON.stringify({
    taskType,
    modelKey,
    systemPrompt,
    userMsg,
    json_mode: !!opts.json_mode,
    max_tokens: opts.max_tokens || null,
    temperature: opts.temperature ?? null,
  });
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  return `model_router:cache:${taskType}:${modelKey}:${hash}`;
}

async function getCached(taskType, modelKey, policy, systemPrompt, userMsg, opts) {
  const ttl = Number(policy.cache_ttl_sec || MODEL_CACHE_TTL_SEC);
  if (!_redis || !policy.cacheable || ttl <= 0) return null;

  try {
    const key = cacheKey(taskType, modelKey, systemPrompt, userMsg, opts);
    const raw = await _redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...parsed, cache_hit: true, from_cache: true };
  } catch (_) {
    return null;
  }
}

async function setCached(taskType, modelKey, policy, systemPrompt, userMsg, opts, result) {
  const ttl = Number(policy.cache_ttl_sec || MODEL_CACHE_TTL_SEC);
  if (!_redis || !policy.cacheable || ttl <= 0) return;
  try {
    const key = cacheKey(taskType, modelKey, systemPrompt, userMsg, opts);
    await _redis.set(key, JSON.stringify(result), "EX", ttl);
  } catch (_) {}
}

function providerConfigured(provider) {
  switch (provider) {
    case "ollama": return true;
    case "openai": return !!process.env.OPENAI_API_KEY;
    case "deepseek": return !!deepseekApiKey();
    case "gemini": return !!geminiApiKey();
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    default: return false;
  }
}

function isRateLimitError(err) {
  const status = err?.status || err?.statusCode || 0;
  const msg = String(err?.message || "").toLowerCase();
  return status === 429 || status === 503 || status === 529 || msg.includes("rate limit") || msg.includes("quota") || msg.includes("too many requests");
}

function isHardProviderError(err) {
  const status = err?.status || err?.statusCode || 0;
  return status >= 500 || status === 429;
}

function isTimeoutError(err) {
  const code = String(err?.code || "").toUpperCase();
  const name = String(err?.name || "").toLowerCase();
  const msg = String(err?.message || "").toLowerCase();
  return code === "ABORT_ERR" || name.includes("timeout") || msg.includes("timed out") || msg.includes("timeout");
}

async function isRateLimited(provider) {
  if (!_redis) return false;
  try {
    return (await _redis.get(`${REDIS_RL_PREFIX}${provider}`)) != null;
  } catch {
    return false;
  }
}

async function markRateLimited(provider) {
  if (!_redis) return;
  try {
    await _redis.set(`${REDIS_RL_PREFIX}${provider}`, "1", "EX", RL_TTL_SEC);
  } catch {}
}

async function clearRateLimit(provider) {
  if (!_redis) return;
  try { await _redis.del(`${REDIS_RL_PREFIX}${provider}`); } catch {}
}

function pricingCost(modelKey, tokensIn, tokensOut) {
  const def = MODELS[modelKey];
  if (!def) return 0;
  const [inCost, outCost] = def.cost_per_1k || [0, 0];
  return ((tokensIn || 0) * inCost + (tokensOut || 0) * outCost) / 1000;
}

async function refreshBudgetSnapshot(force = false) {
  const now = Date.now();
  if (!force && now - _budgetSnapshot.at < MODEL_BUDGET_REFRESH_MS) return _budgetSnapshot;

  try {
    const { rows } = await pg.query(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS total,
         COALESCE(SUM(CASE WHEN provider = 'openai' THEN cost_usd ELSE 0 END), 0) AS openai,
         COALESCE(SUM(CASE WHEN provider = 'deepseek' THEN cost_usd ELSE 0 END), 0) AS deepseek,
         COALESCE(SUM(CASE WHEN provider = 'gemini' THEN cost_usd ELSE 0 END), 0) AS gemini,
         COALESCE(SUM(CASE WHEN model_key = 'openai_codex' THEN cost_usd ELSE 0 END), 0) AS codex,
         COALESCE(SUM(CASE WHEN provider = 'anthropic' THEN cost_usd ELSE 0 END), 0) AS anthropic
       FROM model_usage
       WHERE created_at >= date_trunc('day', timezone('UTC', now()))`
    );

    _budgetSnapshot = {
      at: now,
      total: Number(rows?.[0]?.total || 0),
      openai: Number(rows?.[0]?.openai || 0),
      deepseek: Number(rows?.[0]?.deepseek || 0),
      gemini: Number(rows?.[0]?.gemini || 0),
      codex: Number(rows?.[0]?.codex || 0),
      anthropic: Number(rows?.[0]?.anthropic || 0),
    };
  } catch (err) {
    console.warn(`[model-router] budget snapshot failed: ${err.message}`);
  }

  return _budgetSnapshot;
}

function throttleBand(snapshot, provider) {
  const caps = {
    openai: OPENAI_DAILY_BUDGET_USD,
    deepseek: DEEPSEEK_DAILY_BUDGET_USD,
    gemini: GEMINI_DAILY_BUDGET_USD,
    anthropic: ANTHROPIC_DAILY_BUDGET_USD,
    total: LLM_DAILY_BUDGET_USD,
  };
  const usage = {
    openai: snapshot.openai,
    deepseek: snapshot.deepseek,
    gemini: snapshot.gemini,
    anthropic: snapshot.anthropic,
    total: snapshot.total,
  };
  const cap = caps[provider] || caps.total;
  const used = usage[provider] ?? usage.total;
  if (!Number.isFinite(cap) || cap <= 0) return "none";
  const ratio = used / cap;
  if (ratio >= 1) return "100";
  if (ratio >= 0.9) return "90";
  if (ratio >= 0.8) return "80";
  return "none";
}

function budgetBlocked(modelKey, taskType, policy, snapshot, opts = {}) {
  const def = MODELS[modelKey];
  if (!def) return { blocked: true, reason: "unknown_model" };

  // 1) total cap
  if (snapshot.total >= LLM_DAILY_BUDGET_USD) {
    const allowCriticalWithToken = !!policy.critical && !!opts.approval_token;
    if (!allowCriticalWithToken) {
      return { blocked: true, reason: "total_cap_exceeded" };
    }
  }

  // 2) provider cap
  if (def.provider === "openai" && snapshot.openai >= OPENAI_DAILY_BUDGET_USD) {
    return { blocked: true, reason: "openai_cap_exceeded" };
  }
  if (def.provider === "deepseek" && snapshot.deepseek >= DEEPSEEK_DAILY_BUDGET_USD) {
    return { blocked: true, reason: "deepseek_cap_exceeded" };
  }
  if (def.provider === "gemini" && snapshot.gemini >= GEMINI_DAILY_BUDGET_USD) {
    return { blocked: true, reason: "gemini_cap_exceeded" };
  }
  if (def.provider === "anthropic" && snapshot.anthropic >= ANTHROPIC_DAILY_BUDGET_USD) {
    return { blocked: true, reason: "anthropic_cap_exceeded" };
  }
  if (def.provider === "anthropic" && !ANTHROPIC_ALLOWED) {
    return { blocked: true, reason: "anthropic_disabled" };
  }

  // 3) codex subclass cap
  if (modelKey === "openai_codex" && snapshot.codex >= OPENAI_CODEX_DAILY_BUDGET_USD) {
    return { blocked: true, reason: "codex_cap_exceeded" };
  }

  // Emergency throttle bands
  const band = throttleBand(snapshot, def.provider);
  if (band === "80" && policy.cacheable && taskType !== "patch" && taskType !== "orchestrate") {
    return { blocked: false, reason: "throttle_80_cache_only", cache_only: true };
  }
  if (band === "90" && !policy.critical) {
    return { blocked: true, reason: "throttle_90_noncritical_disabled" };
  }
  if (band === "100" && !policy.critical) {
    return { blocked: true, reason: "throttle_100_noncritical_disabled" };
  }

  return { blocked: false, reason: null };
}

async function callOllama(modelDef, systemPrompt, userMsg, opts = {}) {
  const indexSnippet =
    OLLAMA_INDEX_CONTEXT_ENABLED && opts.disable_index_context !== true
      ? sharedIndexSnippet()
      : "";
  const systemPromptWithIndex = indexSnippet
    ? [
        String(systemPrompt || "").trim(),
        `Shared Code Index Context (auto-injected):\n${indexSnippet}`,
      ].filter(Boolean).join("\n\n")
    : systemPrompt;

  const body = {
    model: modelDef.model,
    stream: false,
    messages: [
      ...(systemPromptWithIndex ? [{ role: "system", content: systemPromptWithIndex }] : []),
      { role: "user", content: userMsg },
    ],
    options: {
      temperature: opts.temperature ?? 0.1,
    },
  };

  const hosts = ollamaHosts();
  const start = stableHostStartIndex(opts.task_type || "", userMsg, opts, hosts.length);
  const ordered = hosts.slice(start).concat(hosts.slice(0, start));
  const errors = [];

  for (const host of ordered) {
    const endpoint = `${host}/api/chat`;
    const started = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeout_ms || 45000),
      });
      const latency_ms = Date.now() - started;
      const data = await res.json();
      if (!res.ok) {
        errors.push(`${host} http_${res.status}`);
        continue;
      }

      const text = data?.message?.content || data?.response || "";
      const promptEvalCount = Number(data?.prompt_eval_count || 0);
      const evalCount = Number(data?.eval_count || 0);
      return {
        text,
        tokens_in: promptEvalCount,
        tokens_out: evalCount,
        cost_usd: 0,
        latency_ms,
        ollama_host: host,
      };
    } catch (err) {
      errors.push(`${host} ${String(err?.message || "error")}`);
    }
  }

  const e = new Error(`Ollama all hosts failed: ${errors.slice(0, 3).join(" | ")}`);
  e.status = 503;
  throw e;
}

async function callOpenAI(modelDef, systemPrompt, userMsg, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const sanitizedUserMsg = sanitizeMultimodalContent(userMsg);

  const started = Date.now();
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelDef.model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: sanitizedUserMsg },
      ],
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.max_tokens || 1200,
      response_format: opts.json_mode ? { type: "json_object" } : undefined,
    }),
    signal: AbortSignal.timeout(opts.timeout_ms || 60000),
  });
  const latency_ms = Date.now() - started;

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`OpenAI ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  const tokens_in = Number(usage.prompt_tokens || 0);
  const tokens_out = Number(usage.completion_tokens || 0);

  return {
    text,
    tokens_in,
    tokens_out,
    cost_usd: pricingCost(findModelKeyByModelId(modelDef.model) || "openai_mini", tokens_in, tokens_out),
    latency_ms,
  };
}

async function callDeepSeek(modelDef, systemPrompt, userMsg, opts = {}) {
  const apiKey = deepseekApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  const sanitizedUserMsg = sanitizeMultimodalContent(userMsg);

  const started = Date.now();
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelDef.model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: sanitizedUserMsg },
      ],
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.max_tokens || 1200,
      response_format: opts.json_mode ? { type: "json_object" } : undefined,
    }),
    signal: AbortSignal.timeout(opts.timeout_ms || 60000),
  });
  const latency_ms = Date.now() - started;

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`DeepSeek ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  const tokens_in = Number(usage.prompt_tokens || 0);
  const tokens_out = Number(usage.completion_tokens || 0);

  return {
    text,
    tokens_in,
    tokens_out,
    cost_usd: pricingCost(findModelKeyByModelId(modelDef.model) || "deepseek_chat", tokens_in, tokens_out),
    latency_ms,
  };
}

async function callGemini(modelDef, systemPrompt, userMsg, opts = {}) {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(modelDef.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${userMsg}` : userMsg }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.1,
      maxOutputTokens: opts.max_tokens || 1200,
      responseMimeType: opts.json_mode ? "application/json" : "text/plain",
    },
  };

  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout_ms || 60000),
  });
  const latency_ms = Date.now() - started;
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  const usage = data?.usageMetadata || {};
  const tokens_in = Number(usage.promptTokenCount || 0);
  const tokens_out = Number(usage.candidatesTokenCount || usage.totalTokenCount || 0);

  return {
    text,
    tokens_in,
    tokens_out,
    cost_usd: pricingCost(findModelKeyByModelId(modelDef.model) || "gemini_flash", tokens_in, tokens_out),
    latency_ms,
  };
}

async function callAnthropic(modelDef, systemPrompt, userMsg, opts = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const started = Date.now();

  const res = await _anthropic.messages.create({
    model: modelDef.model,
    max_tokens: opts.max_tokens || 1200,
    temperature: opts.temperature ?? 0.1,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: "user", content: userMsg }],
  });

  const latency_ms = Date.now() - started;
  const text = (res?.content || [])
    .filter((c) => c?.type === "text")
    .map((c) => c?.text || "")
    .join("");

  const usage = res?.usage || {};
  const tokens_in = Number(usage.input_tokens || 0);
  const tokens_out = Number(usage.output_tokens || 0);

  return {
    text,
    tokens_in,
    tokens_out,
    cost_usd: pricingCost(findModelKeyByModelId(modelDef.model) || "api_haiku", tokens_in, tokens_out),
    latency_ms,
  };
}

async function callProvider(modelKey, systemPrompt, userMsg, opts = {}) {
  const modelDef = MODELS[modelKey];
  if (!modelDef) throw new Error(`Unknown model key: ${modelKey}`);
  switch (modelDef.provider) {
    case "ollama": return callOllama(modelDef, systemPrompt, userMsg, opts);
    case "openai": return callOpenAI(modelDef, systemPrompt, userMsg, opts);
    case "deepseek": return callDeepSeek(modelDef, systemPrompt, userMsg, opts);
    case "gemini": return callGemini(modelDef, systemPrompt, userMsg, opts);
    case "anthropic": return callAnthropic(modelDef, systemPrompt, userMsg, opts);
    default: throw new Error(`Unsupported provider: ${modelDef.provider}`);
  }
}

function findModelKeyByModelId(modelId) {
  for (const [k, v] of Object.entries(MODELS)) {
    if (v.model === modelId) return k;
  }
  return null;
}

async function trackUsage(entry) {
  const values = [
    entry.task_type,
    entry.model_key,
    entry.provider,
    entry.model_id,
    Number(entry.tokens_in || 0),
    Number(entry.tokens_out || 0),
    Number(entry.cost_usd || 0),
    entry.task_id || null,
    entry.plan_id || null,
    Number(entry.confidence ?? null),
    entry.escalation_reason || null,
    entry.cache_hit === true,
    entry.latency_ms != null ? Number(entry.latency_ms) : null,
    entry.routing_outcome || "success",
    entry.error_code || null,
  ];

  try {
    await pg.query(
      `INSERT INTO model_usage
         (task_type, model_key, provider, model_id, tokens_in, tokens_out, cost_usd, task_id, plan_id,
          confidence, escalation_reason, cache_hit, latency_ms, routing_outcome, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      values
    );
    return;
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    // Backward compatible fallback when telemetry columns are not migrated yet.
    if (!message.includes("column") && !message.includes("does not exist")) {
      console.warn(`[model-router] usage insert failed: ${err.message}`);
      return;
    }
  }

  try {
    await pg.query(
      `INSERT INTO model_usage
         (task_type, model_key, provider, model_id, tokens_in, tokens_out, cost_usd, task_id, plan_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      values.slice(0, 9)
    );
  } catch (err2) {
    console.warn(`[model-router] usage insert fallback failed: ${err2.message}`);
  }
}

function confidenceFor(taskType, policy, llmResult, opts = {}) {
  const explicit = llmResult?.json?.confidence ?? llmResult?.confidence;
  if (explicit != null) return Number(explicit);

  if (policy.json_required) {
    const n = normalizeConfidence(taskType, llmResult, {
      requiredFields: opts.required_fields || [],
      requireCitations: opts.require_citations === true,
    });
    return n.confidence;
  }

  const text = String(llmResult?.text || "").trim();
  if (!text) return 0;
  if (text.length < 32) return 0.55;
  if (text.length < 120) return 0.68;
  return 0.82;
}

function maybeJson(text) {
  if (typeof text !== "string") return null;
  return parseMaybeJson(text);
}

function withDecisionFields(base, extra = {}) {
  const out = {
    ...base,
    provider_used: base.provider,
    model_used: base.model_id,
    confidence: base.confidence ?? null,
    escalation_reason: base.escalation_reason || null,
    cost_usd: Number(base.cost_usd || 0),
    cache_hit: base.cache_hit === true,
    ...extra,
  };
  return out;
}

function parseJsonStrict(text) {
  if (typeof text !== "string") return null;
  let cleaned = text.trim();
  const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) cleaned = match[1].trim();
  return JSON.parse(cleaned);
}

async function runRoute(taskType, systemPrompt, userMsg, opts = {}) {
  const policy = policyForTask(taskType, opts);
  const budget = await refreshBudgetSnapshot();
  
  // Pass budget snapshot to providerChainForTask for degraded mode detection
  const providerChain = providerChainForTask(taskType, policy, { ...opts, budget_snapshot: budget });
  const perProviderAttempts = Math.max(1, Number(policy.max_retries_per_provider || 1) + 1);
  const maxAttemptsTotal = Math.max(3, providerChain.length * perProviderAttempts);
  let attempts = 0;
  let lastErr = null;
  const fallbackReasons = [];

  for (let i = 0; i < providerChain.length; i += 1) {
    if (attempts >= maxAttemptsTotal) break;
    const node = providerChain[i];
    const modelDef = MODELS[node.model_key];
    if (!modelDef) continue;

    if (!providerConfigured(node.provider)) {
      fallbackReasons.push("policy");
      continue;
    }

    if (await isRateLimited(node.provider)) {
      fallbackReasons.push("policy");
      continue;
    }

    const budgetCheck = budgetBlocked(node.model_key, taskType, policy, budget, opts);
    if (budgetCheck.blocked) {
      telemetry.routing_budget_blocked += 1;
      incCounter(telemetry.routing_fallback_reason, "budget_blocked");
      fallbackReasons.push("budget_blocked");
      continue;
    }

    if (budgetCheck.cache_only) {
      const cachedOnly = await getCached(taskType, node.model_key, policy, systemPrompt, userMsg, opts);
      if (cachedOnly) return withDecisionFields(cachedOnly);
      if (ROUTER_BUDGET_HARD_BLOCK) {
        telemetry.routing_budget_blocked += 1;
        incCounter(telemetry.routing_fallback_reason, "budget_blocked");
        fallbackReasons.push("budget_blocked");
        continue;
      }
    }

    const cached = await getCached(taskType, node.model_key, policy, systemPrompt, userMsg, opts);
    if (cached) return withDecisionFields(cached);

    if (i === 0) telemetry.routing_primary_selected += 1;

    let providerAttempts = 0;
    const maxProviderAttempts = perProviderAttempts;

    while (providerAttempts < maxProviderAttempts && attempts < maxAttemptsTotal) {
      attempts += 1;
      providerAttempts += 1;

      try {
        const llm = await callProvider(node.model_key, systemPrompt, userMsg, {
          ...opts,
          task_type: taskType,
          timeout_ms: policy.max_latency_ms,
          json_mode: policy.json_required,
        });

        let parsedJson = maybeJson(llm.text);

        if (policy.json_required && !parsedJson && providerAttempts < maxProviderAttempts) {
          // one repair retry same provider
          incCounter(telemetry.routing_fallback_reason, "parse_error");
          fallbackReasons.push("parse_error");
          userMsg = `${userMsg}\n\nIMPORTANT: Return ONLY strict valid JSON. No markdown, no prose.`;
          continue;
        }

        const confidence = confidenceFor(taskType, policy, { ...llm, json: parsedJson }, opts);
        const threshold = Number(policy.min_confidence ?? MODEL_CONFIDENCE_THRESHOLD);

        if (ROUTER_CONFIDENCE_ENFORCE && confidence < threshold) {
          telemetry.routing_low_confidence_count += 1;
          incCounter(telemetry.routing_fallback_reason, "low_confidence");
          fallbackReasons.push("low_confidence");

          await trackUsage({
            task_type: taskType,
            model_key: node.model_key,
            provider: modelDef.provider,
            model_id: modelDef.model,
            tokens_in: llm.tokens_in,
            tokens_out: llm.tokens_out,
            cost_usd: llm.cost_usd,
            task_id: opts.task_id,
            plan_id: opts.plan_id,
            confidence,
            escalation_reason: "low_confidence",
            cache_hit: false,
            latency_ms: llm.latency_ms,
            routing_outcome: "low_confidence",
            error_code: null,
          });

          if (llm.cost_usd > 0) await refreshBudgetSnapshot(true);
          break; // fallback to next provider
        }

        const result = withDecisionFields({
          text: llm.text,
          json: parsedJson,
          model_key: node.model_key,
          model_id: modelDef.model,
          provider: modelDef.provider,
          tokens_in: llm.tokens_in,
          tokens_out: llm.tokens_out,
          cost_usd: llm.cost_usd,
          confidence,
          escalation_reason: fallbackReasons.length ? normalizeEscalationReason(fallbackReasons[fallbackReasons.length - 1]) : null,
          cache_hit: false,
          latency_ms: llm.latency_ms,
        });

        await trackUsage({
          task_type: taskType,
          model_key: node.model_key,
          provider: modelDef.provider,
          model_id: modelDef.model,
          tokens_in: llm.tokens_in,
          tokens_out: llm.tokens_out,
          cost_usd: llm.cost_usd,
          task_id: opts.task_id,
          plan_id: opts.plan_id,
          confidence,
          escalation_reason: result.escalation_reason,
          cache_hit: false,
          latency_ms: llm.latency_ms,
          routing_outcome: "success",
          error_code: null,
        });

        await setCached(taskType, node.model_key, policy, systemPrompt, userMsg, opts, result);
        if (i > 0) telemetry.routing_fallback_invoked += 1;
        if (llm.cost_usd > 0) await refreshBudgetSnapshot(true);

        return result;
      } catch (err) {
        lastErr = err;
        const reason = isRateLimitError(err)
          ? "policy"
          : (isTimeoutError(err) ? "timeout" : (isHardProviderError(err) ? "provider_error" : "provider_error"));
        fallbackReasons.push(reason);

        if (isRateLimitError(err)) {
          await markRateLimited(node.provider);
        }

        incCounter(telemetry.routing_provider_error_rate, node.provider);
        incCounter(telemetry.routing_fallback_reason, reason);

        await trackUsage({
          task_type: taskType,
          model_key: node.model_key,
          provider: modelDef.provider,
          model_id: modelDef.model,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          task_id: opts.task_id,
          plan_id: opts.plan_id,
          confidence: null,
          escalation_reason: reason,
          cache_hit: false,
          latency_ms: null,
          routing_outcome: "error",
          error_code: String(err.status || err.code || "provider_error"),
        });

        if (providerAttempts >= maxProviderAttempts) break;
      }
    }
  }

  if (ROUTER_BUDGET_HARD_BLOCK && lastErr && /cap_exceeded|throttle/.test(String(lastErr.message || ""))) {
    const error = new Error(`BUDGET_BLOCKED: ${lastErr.message}`);
    error.code = "BUDGET_BLOCKED";
    throw error;
  }

  if (fallbackReasons.includes("budget_blocked")) {
    const error = new Error(`BUDGET_BLOCKED: no eligible provider for ${taskType}`);
    error.code = "BUDGET_BLOCKED";
    throw error;
  }

  if (!lastErr) {
    const error = new Error(`BUDGET_BLOCKED: no eligible provider for ${taskType}`);
    error.code = "BUDGET_BLOCKED";
    throw error;
  }

  throw new Error(`[model-router] All providers exhausted for ${taskType}. Last: ${lastErr.message}`);
}

async function chat(taskType, systemPrompt, userMsg, opts = {}) {
  const result = await runRoute(taskType, systemPrompt, userMsg, opts);
  return result;
}

async function chatJson(taskType, systemPrompt, userMsg, opts = {}) {
  const result = await runRoute(taskType, systemPrompt, userMsg, {
    ...opts,
    json_mode: true,
  });

  if (!result.json) {
    try {
      result.json = parseJsonStrict(result.text);
    } catch (err) {
      const e = new Error(`[model-router] JSON parse failed after routing (${result.model_key}): ${err.message}`);
      e.code = "PARSE_ERROR";
      throw e;
    }
  }

  return result;
}

async function status() {
  const providers = ["ollama", "openai", "deepseek", "gemini", "anthropic"];
  const out = {};
  for (const p of providers) {
    out[p] = {
      configured: providerConfigured(p),
      rate_limited: await isRateLimited(p),
    };
  }
  out.budgets = await refreshBudgetSnapshot();
  return out;
}

async function resetRateLimit(provider) {
  await clearRateLimit(provider);
}

function routingStats() {
  return {
    generated_at: nowIso(),
    routing: {
      primary_selected: telemetry.routing_primary_selected,
      fallback_invoked: telemetry.routing_fallback_invoked,
      fallback_reason: telemetry.routing_fallback_reason,
      budget_blocked: telemetry.routing_budget_blocked,
      low_confidence_count: telemetry.routing_low_confidence_count,
      provider_error_rate: telemetry.routing_provider_error_rate,
    },
    limits: {
      total: LLM_DAILY_BUDGET_USD,
      openai: OPENAI_DAILY_BUDGET_USD,
      deepseek: DEEPSEEK_DAILY_BUDGET_USD,
      gemini: GEMINI_DAILY_BUDGET_USD,
      codex: OPENAI_CODEX_DAILY_BUDGET_USD,
      anthropic: ANTHROPIC_DAILY_BUDGET_USD,
    },
    flags: {
      ROUTER_POLICY_ENFORCE,
      ROUTER_BUDGET_HARD_BLOCK,
      ROUTER_CONFIDENCE_ENFORCE,
    },
  };
}

// Legacy export for code reading TASK_ROUTE.
const TASK_ROUTE = Object.freeze({ _managed_by_policy: true });

if (ROUTER_POLICY_ENFORCE) {
  loadRoutingPolicy(true);
}

module.exports = {
  chat,
  chatJson,
  status,
  resetRateLimit,
  routingStats,
  MODELS,
  TASK_ROUTE,
};

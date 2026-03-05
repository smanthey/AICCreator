"use strict";

require("dotenv").config();

function ok(v) {
  return !!String(v || "").trim();
}

function mask(v) {
  const s = String(v || "");
  if (!s) return "";
  if (s.length <= 8) return "*".repeat(s.length);
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function row(name, configured, detail = "") {
  return { provider: name, configured: configured ? "yes" : "no", detail };
}

function printEnvHints() {
  console.log("\nRequired env keys for low-Anthropic high-throughput:");
  console.log("- DEEPSEEK_API_KEY (or DEEPSEEK_KEY)");
  console.log("- GEMINI_API_KEY (or GOOGLE_API_KEY / GOOGLE_GENAI_API_KEY)");
  console.log("- OPENAI_API_KEY (optional but recommended fallback)");
  console.log("- ANTHROPIC_ALLOWED=false (to minimize Anthropic usage)");
}

function deepseekKey() {
  return String(
    process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_KEY ||
    ""
  ).trim();
}

function geminiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_KEY ||
    ""
  ).trim();
}

function normalizeHost(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const base = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  return base.replace(/\/+$/, "");
}

function ollamaHosts() {
  const primary = normalizeHost(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
  const extra = String(process.env.MODEL_FLEET_OLLAMA_HOSTS || process.env.OLLAMA_HOSTS || "")
    .split(",")
    .map((x) => normalizeHost(x))
    .filter(Boolean);
  return [...new Set([primary, ...extra].filter(Boolean))];
}

const OLLAMA_MODEL_ENVS = [
  "OLLAMA_MODEL_FAST",
  "OLLAMA_CLASSIFY_MODEL",
  "OLLAMA_MODEL_QWEN3_32B",
  "OLLAMA_MODEL_QWEN3_14B",
  "OLLAMA_MODEL_QWEN3_7B",
  "OLLAMA_MODEL_QWEN3_CODER_30B",
  "OLLAMA_MODEL_CODESTRAL_22B",
  "OLLAMA_MODEL_DEEPSEEK_R1",
];

function requestedOllamaModels() {
  const fallback = {
    OLLAMA_MODEL_FAST: "llama3.1:8b",
    OLLAMA_CLASSIFY_MODEL: "llama3.1:8b",
    OLLAMA_MODEL_QWEN3_32B: "qwen2.5:14b",
    OLLAMA_MODEL_QWEN3_14B: "qwen2.5:14b",
    OLLAMA_MODEL_QWEN3_7B: "llama3.1:8b",
    OLLAMA_MODEL_QWEN3_CODER_30B: "qwen2.5-coder:7b",
    OLLAMA_MODEL_CODESTRAL_22B: "deepseek-coder:6.7b",
    OLLAMA_MODEL_DEEPSEEK_R1: "deepseek-r1:8b",
  };
  return [...new Set(OLLAMA_MODEL_ENVS.map((k) => String(process.env[k] || fallback[k] || "").trim()).filter(Boolean))];
}

function hasTag(installed, requested) {
  if (!requested) return false;
  if (installed.has(requested)) return true;
  const bare = requested.split(":")[0];
  return installed.has(bare) || installed.has(`${bare}:latest`);
}

async function checkOllamaFleet() {
  const hosts = ollamaHosts();
  const required = requestedOllamaModels();
  const details = [];
  let reachable = 0;
  let missingTotal = 0;

  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const tags = new Set((body.models || []).map((m) => String(m.model || m.name || "")).filter(Boolean));
      const missing = required.filter((tag) => !hasTag(tags, tag));
      reachable += 1;
      missingTotal += missing.length;
      details.push(`${host}:ok missing=${missing.length}`);
    } catch (err) {
      details.push(`${host}:down (${String(err.message || err).slice(0, 40)})`);
    }
  }

  if (reachable === 0) {
    return { ok: false, detail: `no reachable hosts (${details.join("; ")})` };
  }
  if (missingTotal > 0) {
    return { ok: false, detail: `reachable=${reachable}/${hosts.length} missing_models=${missingTotal} (${details.join("; ")})` };
  }
  return { ok: true, detail: `reachable=${reachable}/${hosts.length} models_ready (${details.join("; ")})` };
}

async function checkGemini() {
  const key = geminiKey();
  if (!ok(key)) return { ok: false, detail: "missing GEMINI_API_KEY" };
  const base = String(process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const model = process.env.GEMINI_MODEL_FAST || "gemini-2.0-flash";
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, detail: `HTTP ${res.status}: ${String(t).slice(0, 120)}` };
    }
    return { ok: true, detail: `model=${model}` };
  } catch (err) {
    return { ok: false, detail: String(err.message || err) };
  }
}

async function checkDeepSeek() {
  const key = deepseekKey();
  if (!ok(key)) return { ok: false, detail: "missing DEEPSEEK_API_KEY" };
  const base = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL_FAST || "deepseek-chat";
  const url = `${base}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, detail: `HTTP ${res.status}: ${String(t).slice(0, 120)}` };
    }
    return { ok: true, detail: `model=${model}` };
  } catch (err) {
    return { ok: false, detail: String(err.message || err) };
  }
}

async function main() {
  const ollama = await checkOllamaFleet();
  const deepseek = await checkDeepSeek();
  const gemini = await checkGemini();

  const rows = [
    row("ollama_fleet", ollama.ok, ollama.detail),
    row("deepseek", deepseek.ok, deepseek.detail),
    row("gemini", gemini.ok, gemini.detail),
    row("openai", ok(process.env.OPENAI_API_KEY), ok(process.env.OPENAI_API_KEY) ? `key=${mask(process.env.OPENAI_API_KEY)}` : "missing OPENAI_API_KEY"),
    row("anthropic", ok(process.env.ANTHROPIC_API_KEY), `allowed=${String(process.env.ANTHROPIC_ALLOWED || "true")}`),
  ];

  console.log("\n=== Provider Setup Check ===");
  console.table(rows);
  printEnvHints();

  const pass = ollama.ok && deepseek.ok && gemini.ok;
  console.log(`\nstatus=${pass ? "PASS" : "NEEDS_CONFIG"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

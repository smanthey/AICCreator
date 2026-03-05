"use strict";

require("dotenv").config();

const CACHE_MS = Math.max(5000, Number(process.env.AI_LANE_HEALTH_CACHE_MS || 30000));
const HTTP_TIMEOUT_MS = Math.max(1000, Number(process.env.AI_LANE_HEALTH_TIMEOUT_MS || 4000));

let _cached = null;
let _cachedAt = 0;

function withTimeout(ms) {
  return AbortSignal.timeout(ms);
}

function normalizeOllamaHost() {
  const raw = String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

function normalizeOllamaHosts() {
  const primary = normalizeOllamaHost();
  const extra = String(process.env.OLLAMA_HOSTS || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .map((x) => (/^https?:\/\//i.test(x) ? x : `http://${x}`));
  return [...new Set([primary, ...extra].map((x) => x.replace(/\/+$/, "")))];
}

async function probeOllamaHost(base) {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: withTimeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `ollama_http_${res.status}`, host: base };
    const data = await res.json().catch(() => null);
    const modelCount = Array.isArray(data?.models) ? data.models.length : 0;
    return {
      ok: modelCount > 0,
      reason: modelCount > 0 ? "ok" : "no_models_downloaded",
      host: base,
      model_count: modelCount,
    };
  } catch (err) {
    return { ok: false, reason: `ollama_unreachable:${err.message}`, host: base };
  }
}

async function probeOllama() {
  const hosts = normalizeOllamaHosts();
  const probes = await Promise.all(hosts.map((h) => probeOllamaHost(h)));
  const healthy = probes.filter((p) => p.ok);
  if (healthy.length > 0) {
    return {
      ok: true,
      reason: "ok",
      hosts_total: probes.length,
      hosts_healthy: healthy.length,
      hosts: probes,
    };
  }
  return {
    ok: false,
    reason: probes[0]?.reason || "ollama_unreachable",
    hosts_total: probes.length,
    hosts_healthy: 0,
    hosts: probes,
  };
}

async function probeOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "openai_key_missing" };
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: withTimeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, reason: `openai_http_${res.status}` };
    }
    return { ok: true, reason: "ok" };
  } catch (err) {
    return { ok: false, reason: `openai_unreachable:${err.message}` };
  }
}

async function probeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: "anthropic_key_missing" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal: withTimeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, reason: `anthropic_http_${res.status}` };
    }
    return { ok: true, reason: "ok" };
  } catch (err) {
    return { ok: false, reason: `anthropic_unreachable:${err.message}` };
  }
}

async function getAiLaneHealth(force = false) {
  const now = Date.now();
  if (!force && _cached && (now - _cachedAt) < CACHE_MS) return _cached;

  const [ollama, openai, anthropic] = await Promise.all([
    probeOllama(),
    probeOpenAI(),
    probeAnthropic(),
  ]);

  const api_ok = !!(openai.ok || anthropic.ok);
  const ready = !!(ollama.ok || api_ok);
  const status = {
    ready,
    checked_at: new Date().toISOString(),
    ollama_ok: ollama.ok,
    api_ok,
    openai_ok: openai.ok,
    anthropic_ok: anthropic.ok,
    reasons: {
      ollama: ollama.reason,
      openai: openai.reason,
      anthropic: anthropic.reason,
    },
    ollama_hosts: ollama.hosts || [],
    ollama_hosts_total: ollama.hosts_total || 0,
    ollama_hosts_healthy: ollama.hosts_healthy || 0,
  };

  _cached = status;
  _cachedAt = now;
  return status;
}

module.exports = {
  getAiLaneHealth,
};

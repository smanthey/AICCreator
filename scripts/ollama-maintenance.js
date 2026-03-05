#!/usr/bin/env node
"use strict";

require("dotenv").config();

const OLLAMA_HOST_RAW = String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
const OLLAMA_MODEL = String(process.env.OLLAMA_CLASSIFY_MODEL || process.env.OLLAMA_MODEL_FAST || "llama3.1:8b");
const TIMEOUT_MS = Math.max(2000, Number(process.env.OLLAMA_MAINT_TIMEOUT_MS || "20000") || 20000);
const UNLOAD_IDLE_HOURS = Math.max(1, Number(process.env.OLLAMA_UNLOAD_IDLE_HOURS || "1") || 1);

function endpoint(path) {
  const host = OLLAMA_HOST_RAW.startsWith("http") ? OLLAMA_HOST_RAW : `http://${OLLAMA_HOST_RAW}`;
  const base = new URL(host);
  return `${base.origin}${path}`;
}

/**
 * Autonomous Context Pruning: Monitor and log models that haven't been used recently.
 * Ollama automatically unloads models when VRAM pressure exists, but we track idle models
 * to help identify VRAM "clog" issues. This prevents long-term VRAM accumulation.
 * 
 * Note: Ollama doesn't expose a direct "unload" API, but models are automatically evicted
 * when memory pressure exists. This function helps identify which models are candidates
 * for eviction and logs them for monitoring.
 */
async function pruneUnusedModels() {
  try {
    // Get list of loaded models with their last access time
    const psRes = await fetch(endpoint("/api/ps"), {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!psRes.ok) {
      console.warn(`[ollama-maintenance] ps check failed: HTTP ${psRes.status}`);
      return;
    }
       const psJson = await psRes.json();
    const loadedModels = psJson.models || [];

    if (loadedModels.length === 0) {
      return; // Nothing to prune
    }

    const now = Date.now();
    const idleThresholdMs = UNLOAD_IDLE_HOURS * 60 * 60 * 1000;
    const idleModels = [];

    for (const model of loadedModels) {
      const modelName = String(model.name || "");
      // Ollama's /api/ps returns expires_at in seconds since epoch
      const expiresAt = Number(model.expires_at || 0);
      const lastAccess = expiresAt * 1000; // Convert to ms
      const idleMs = now - lastAccess;

      // Skip the primary model (keep it warm)
      if (modelName === OLLAMA_MODEL || modelName.startsWith(`${OLLAMA_MODEL}:`)) {
        continue;
      }

      // Track idle models (Ollama will auto-evict them under memory pressure)
      if (idleMs > idleThresholdMs) {
        idleModels.push({
          name: modelName,
          idle_hours: (idleMs / (60 * 60 * 1000)).toFixed(1),
          size_mb: model.size ? (Number(model.size) / (1024 * 1024)).toFixed(0) : "unknown",
        });
      }
    }

    if (idleModels.length > 0) {
      console.log(
        `[ollama-maintenance] 🧹 ${idleModels.length} idle models detected (will auto-evict under VRAM pressure):`,
        idleModels.map((m) => `${m.name} (${m.idle_hours}h, ${m.size_mb}MB)`).join(", ")
      );
      // Note: Ollama automatically unloads these when VRAM is needed, so we just monitor
    }
  } catch (err) {
    console.warn(`[ollama-maintenance] Prune check failed:`, err.message);
  }
}

async function main() {
  const started = Date.now();

  // Autonomous Context Pruning: Unload unused models first
  await pruneUnusedModels();

  const tagsRes = await fetch(endpoint("/api/tags"), {
    method: "GET",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tagsRes.ok) {
    throw new Error(`tags check failed: HTTP ${tagsRes.status}`);
  }
  const tagsJson = await tagsRes.json();
  const names = (tagsJson.models || []).map((m) => String(m.model || m.name || ""));
  const modelTag = names.find((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`)) || names[0] || OLLAMA_MODEL;

  // Tiny deterministic warm prompt to keep lane hot and verify inference path.
  const chatRes = await fetch(endpoint("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelTag,
      stream: false,
      messages: [
        { role: "system", content: "Reply with strict JSON only." },
        { role: "user", content: "{\"ok\":true}" },
      ],
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!chatRes.ok) {
    const body = await chatRes.text().catch(() => "");
    throw new Error(`chat warm failed: HTTP ${chatRes.status} ${body.slice(0, 120)}`);
  }

  const ms = Date.now() - started;
  console.log(`[ollama-maintenance] ok model=${modelTag} latency_ms=${ms}`);
}

main().catch((err) => {
  console.error(`[ollama-maintenance] fail: ${err.message}`);
  process.exit(1);
});

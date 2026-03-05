#!/usr/bin/env node
"use strict";

require("dotenv").config();

const APPLY = process.argv.includes("--apply");
const OLLAMA_HOST_RAW = String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
const REDUNDANT = new Set(["gemma2:2b", "llama3.2:3b", "qwen3:4b", "qwen3:1.7b"]);

function endpoint(path) {
  const host = OLLAMA_HOST_RAW.startsWith("http") ? OLLAMA_HOST_RAW : `http://${OLLAMA_HOST_RAW}`;
  const base = new URL(host);
  return `${base.origin}${path}`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${txt.slice(0, 220)}`);
  return json;
}

async function deleteModel(model) {
  const out = await fetchJson(endpoint("/api/delete"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return out;
}

async function main() {
  const tags = await fetchJson(endpoint("/api/tags"), { method: "GET" });
  const installed = (tags.models || []).map((m) => String(m.model || m.name || "")).filter(Boolean);
  const installedSet = new Set(installed);
  const candidates = [...REDUNDANT].filter((m) => installedSet.has(m) || installedSet.has(m.split(":")[0]));

  console.log("=== Ollama Redundant Model Prune ===");
  console.log(`host=${OLLAMA_HOST_RAW}`);
  console.log(`mode=${APPLY ? "apply" : "dry-run"}`);
  console.log(`installed=${installed.length}`);

  if (!candidates.length) {
    console.log("No redundant models found.");
    return;
  }

  console.log(`candidates=${candidates.join(", ")}`);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to remove.");
    return;
  }

  const removed = [];
  const failed = [];
  for (const model of candidates) {
    try {
      await deleteModel(model);
      removed.push(model);
      console.log(`[removed] ${model}`);
    } catch (err) {
      failed.push({ model, error: err.message });
      console.log(`[failed] ${model}: ${err.message}`);
    }
  }

  console.log(`summary removed=${removed.length} failed=${failed.length}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[ollama-prune-redundant] fatal: ${err.message}`);
  process.exit(1);
});


#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "model-fleet-setup-latest.json");

const TIMEOUT_MS = Math.max(3000, Number(process.env.MODEL_FLEET_TIMEOUT_MS || "20000") || 20000);
const PULL_TIMEOUT_MS = Math.max(120000, Number(process.env.MODEL_FLEET_PULL_TIMEOUT_MS || "2700000") || 2700000);
const PROFILE = getArg("--profile", "balanced");
const PULL_LOCAL = hasFlag("--pull-missing-local");
const PULL_REMOTE = hasFlag("--pull-missing-remote");

const PORTFOLIO = [
  { key: "qwen3_32b", env: "OLLAMA_MODEL_QWEN3_32B", fallback: "qwen2.5:14b" },
  { key: "qwen3_14b", env: "OLLAMA_MODEL_QWEN3_14B", fallback: "qwen2.5:14b" },
  { key: "qwen3_7b", env: "OLLAMA_MODEL_QWEN3_7B", fallback: "llama3.1:8b" },
  { key: "qwen3_1_7b", env: "OLLAMA_MODEL_QWEN3_1_7B", fallback: "llama3.1:8b" },
  { key: "mistral_small_3_2", env: "OLLAMA_MODEL_MISTRAL_SMALL_3_2", fallback: "llama3.1:8b" },
  { key: "deepseek_r1", env: "OLLAMA_MODEL_DEEPSEEK_R1", fallback: "deepseek-r1:8b" },
  { key: "deepseek_v3", env: "OLLAMA_MODEL_DEEPSEEK_V3", fallback: "deepseek-r1:8b" },
  { key: "llama3_2_3b", env: "OLLAMA_MODEL_LLAMA3_2_3B", fallback: "llama3.1:8b" },
  { key: "gemma_2b", env: "OLLAMA_MODEL_GEMMA_2B", fallback: "llama3.1:8b" },
  { key: "qwen3_coder_30b", env: "OLLAMA_MODEL_QWEN3_CODER_30B", fallback: "qwen2.5-coder:7b" },
  { key: "codestral_22b", env: "OLLAMA_MODEL_CODESTRAL_22B", fallback: "deepseek-coder:6.7b" },
];

const PROFILES = {
  edge: new Set(["qwen3_7b", "qwen3_1_7b", "llama3_2_3b"]),
  balanced: new Set(["qwen3_14b", "deepseek_r1", "qwen3_7b", "llama3_2_3b"]),
  coding: new Set(["qwen3_coder_30b", "codestral_22b", "qwen3_14b", "deepseek_r1"]),
  full: null,
};

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const value = String(process.argv[i + 1] || "").trim();
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function normalizeHost(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const base = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  return base.replace(/\/+$/, "");
}

function fleetHosts() {
  const primary = normalizeHost(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
  const explicit = String(process.env.MODEL_FLEET_OLLAMA_HOSTS || process.env.OLLAMA_HOSTS || "")
    .split(",")
    .map((x) => normalizeHost(x))
    .filter(Boolean);
  return [...new Set([primary, ...explicit].filter(Boolean))];
}

function resolveSpecs() {
  const selected = PROFILES[PROFILE] ?? PROFILES.balanced;
  if (!selected) return PORTFOLIO;
  return PORTFOLIO.filter((s) => selected.has(s.key));
}

function resolveTag(spec) {
  return String(process.env[spec.env] || spec.fallback || "").trim();
}

async function fetchJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 180)}`);
  return json;
}

function isLocalHost(host) {
  return /127\.0\.0\.1|localhost/i.test(host);
}

function hasTag(installed, requested) {
  if (!requested) return false;
  if (installed.has(requested)) return true;
  const bare = requested.split(":")[0];
  return installed.has(bare) || installed.has(`${bare}:latest`);
}

async function pullViaApi(host, modelTag) {
  await fetchJson(`${host}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelTag, stream: false }),
  }, PULL_TIMEOUT_MS);
}

function sshMap() {
  // Format: http://192.168.1.50:11434=user@m1a,http://192.168.1.51:11434=user@m1b
  const raw = String(process.env.MODEL_FLEET_SSH_MAP || "").trim();
  if (!raw) return new Map();
  const out = new Map();
  for (const pair of raw.split(",")) {
    const [host, target] = pair.split("=");
    const h = normalizeHost(host);
    const t = String(target || "").trim();
    if (h && t) out.set(h, t);
  }
  return out;
}

function remotePullCommand(profile) {
  return `cd ${ROOT} && npm run -s model:portfolio -- --profile ${profile} --pull-missing`;
}

function tryRemotePull(host, profile, sshTargets) {
  const sshTarget = sshTargets.get(host);
  if (!sshTarget) {
    return { ok: false, reason: "no_ssh_mapping" };
  }
  try {
    execSync(`ssh ${sshTarget} ${JSON.stringify(remotePullCommand(profile))}`, { stdio: "inherit" });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err.message || err).slice(0, 220) };
  }
}

async function inspectHost(host, specs, sshTargets) {
  const result = {
    host,
    reachable: false,
    missing: [],
    present: [],
    pulled: [],
    remote_pull: null,
  };

  let tags = [];
  try {
    const tagsJson = await fetchJson(`${host}/api/tags`);
    tags = (tagsJson.models || []).map((m) => String(m.model || m.name || "")).filter(Boolean);
    result.reachable = true;
  } catch (err) {
    result.error = String(err.message || err);
    return result;
  }

  const installed = new Set(tags);
  for (const spec of specs) {
    const tag = resolveTag(spec);
    if (hasTag(installed, tag)) result.present.push(tag);
    else result.missing.push(tag);
  }

  if (result.missing.length && PULL_LOCAL && isLocalHost(host)) {
    for (const tag of result.missing) {
      try {
        await pullViaApi(host, tag);
        result.pulled.push({ tag, ok: true });
      } catch (err) {
        result.pulled.push({ tag, ok: false, error: String(err.message || err).slice(0, 220) });
      }
    }
  }

  if (result.missing.length && PULL_REMOTE && !isLocalHost(host)) {
    result.remote_pull = tryRemotePull(host, PROFILE, sshTargets);
  }

  return result;
}

async function main() {
  const specs = resolveSpecs();
  const hosts = fleetHosts();
  const sshTargets = sshMap();

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    profile: PROFILE,
    pull_missing_local: PULL_LOCAL,
    pull_missing_remote: PULL_REMOTE,
    hosts,
    required_models: specs.map((s) => resolveTag(s)),
    results: [],
  };

  for (const host of hosts) {
    // eslint-disable-next-line no-await-in-loop
    const row = await inspectHost(host, specs, sshTargets);
    report.results.push(row);
  }

  const unreachable = report.results.filter((r) => !r.reachable).length;
  const missing = report.results.reduce((n, r) => n + Number(r.missing?.length || 0), 0);
  report.summary = {
    hosts_total: report.results.length,
    hosts_reachable: report.results.length - unreachable,
    hosts_unreachable: unreachable,
    missing_total: missing,
  };
  report.ok = unreachable === 0 && missing === 0;

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[model-fleet-setup] fatal: ${err.message}`);
  process.exit(1);
});

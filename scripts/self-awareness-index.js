#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "artifacts", "self-awareness");

function sh(cmd, cwd = ROOT) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return String(e.stdout || e.stderr || "").trim();
  }
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function listFiles(dir, exts = null, max = 2000) {
  const out = [];
  function walk(d) {
    if (out.length >= max) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max) break;
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (!exts || exts.includes(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

function safeRel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function parsePm2() {
  try {
    const raw = execSync("pm2 jlist", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => ({
      name: p.name,
      status: p?.pm2_env?.status || "unknown",
      restarts: Number(p?.pm2_env?.restart_time || 0),
      uptime_ms: p?.pm2_env?.pm_uptime ? Math.max(0, Date.now() - Number(p.pm2_env.pm_uptime)) : 0,
      cpu: Number(p?.monit?.cpu || 0),
      mem_mb: Math.round((Number(p?.monit?.memory || 0) / (1024 * 1024)) * 10) / 10,
    }));
  } catch {
    return [];
  }
}

function pickModelConfig() {
  const keys = [
    "CLASSIFY_PROVIDER",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_MODEL_FAST",
    "OPENAI_MODEL_CHEAP",
    "OLLAMA_HOST",
    "OLLAMA_MODEL_FAST",
    "OLLAMA_CLASSIFY_MODEL",
    "ANTHROPIC_MODEL",
  ];
  const out = {};
  for (const k of keys) if (process.env[k]) out[k] = process.env[k];
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pkg = readJson(path.join(ROOT, "package.json"), { scripts: {} });
  const scripts = pkg.scripts || {};

  const sourceRoots = ["scripts", "control", "agents", "workers", "cli", "dashboard", "config", "infra", "docs", "context", "agent-state"];
  const sourceIndex = [];
  for (const d of sourceRoots) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    const files = listFiles(abs, [".js", ".ts", ".tsx", ".md", ".json", ".sql", ".py"], 10000);
    sourceIndex.push({
      root: d,
      count: files.length,
      sample: files.slice(0, 20).map(safeRel),
    });
  }

  const docs = [];
  for (const d of ["docs", "context", "agent-state", "."]) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    const files = listFiles(abs, [".md"], 3000)
      .filter((p) => !p.includes("node_modules"))
      .map(safeRel);
    docs.push(...files);
  }

  const configFiles = [
    "package.json",
    ".env.example",
    "trigger.config.ts",
    "ecosystem.background.config.js",
    "ecosystem.ai-satellite.config.js",
    "ecosystem.i7-satellite.config.js",
  ]
    .map((f) => path.join(ROOT, f))
    .filter((p) => fs.existsSync(p))
    .map(safeRel);

  const harnessScripts = Object.entries(scripts)
    .filter(([k]) => /(qa|e2e|audit|status|verify|workflow|platform|security|capability|github|backup|migrate|pm2)/i.test(k))
    .map(([k, v]) => ({ key: k, cmd: v }));

  const index = {
    generated_at: new Date().toISOString(),
    git: {
      branch: sh("git rev-parse --abbrev-ref HEAD"),
      commit: sh("git rev-parse HEAD"),
      status_short: sh("git status --short"),
      remotes: sh("git remote -v"),
    },
    runtime: {
      node_version: process.version,
      platform: `${process.platform}-${process.arch}`,
      cwd: ROOT,
      pm2: parsePm2(),
    },
    model_config: pickModelConfig(),
    source_index: sourceIndex,
    docs_index: [...new Set(docs)].sort(),
    config_index: configFiles,
    harness: {
      script_count: Object.keys(scripts).length,
      scripts: harnessScripts,
    },
    self_mod_interfaces: [
      "npm run self:aware:index",
      "npm run self:mod:request -- --title \"...\" --request \"...\"",
      "npm run self:mod:worker",
      "npm run autonomy:pr",
    ],
  };

  const ts = Date.now();
  const jsonPath = path.join(OUT_DIR, `${ts}-self-awareness-index.json`);
  const mdPath = path.join(OUT_DIR, `${ts}-self-awareness-index.md`);
  const latestJson = path.join(OUT_DIR, "latest.json");
  const latestMd = path.join(OUT_DIR, "latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(index, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(index, null, 2));

  const md = [];
  md.push("# Self-Awareness Index");
  md.push("");
  md.push(`Generated: ${index.generated_at}`);
  md.push(`Branch: ${index.git.branch}`);
  md.push(`Commit: ${index.git.commit}`);
  md.push("");
  md.push("## Runtime");
  md.push(`- Node: ${index.runtime.node_version}`);
  md.push(`- Platform: ${index.runtime.platform}`);
  md.push(`- PM2 processes: ${index.runtime.pm2.length}`);
  md.push("");
  md.push("## Model Config");
  if (!Object.keys(index.model_config).length) md.push("- (none found in env)");
  for (const [k, v] of Object.entries(index.model_config)) md.push(`- ${k}: ${v}`);
  md.push("");
  md.push("## Source Map");
  for (const s of index.source_index) md.push(`- ${s.root}: ${s.count} files`);
  md.push("");
  md.push("## Docs Map");
  md.push(`- docs/context/agent-state markdown files: ${index.docs_index.length}`);
  md.push("");
  md.push("## Harness Scripts");
  md.push(`- total package scripts: ${index.harness.script_count}`);
  md.push(`- quality/runtime scripts: ${index.harness.scripts.length}`);
  md.push("");
  md.push("## Self-Modification Interfaces");
  for (const x of index.self_mod_interfaces) md.push(`- ${x}`);
  md.push("");

  fs.writeFileSync(mdPath, md.join("\n") + "\n");
  fs.writeFileSync(latestMd, md.join("\n") + "\n");

  console.log("=== Self Awareness Index ===");
  console.log(`latest_json: ${latestJson}`);
  console.log(`latest_md: ${latestMd}`);
}

main();

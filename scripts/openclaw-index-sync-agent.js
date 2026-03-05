#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const SHARED_DIR = path.join(ROOT, "agent-state", "shared-context");

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function readJsonSafe(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function parseTrailingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.indexOf("{"); i >= 0; i = raw.indexOf("{", i + 1)) {
    try {
      return JSON.parse(raw.slice(i));
    } catch {
      // continue
    }
  }
  return null;
}

function runStep(name, command) {
  const r = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: 600000,
  });

  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const parsed = parseTrailingJson(out);
  return {
    name,
    command,
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    parsed: parsed || null,
    stdout_tail: String(r.stdout || "").slice(-1200),
    stderr_tail: String(r.stderr || "").slice(-1200),
  };
}

function buildKnowledge() {
  const symbolic = readJsonSafe(path.join(REPORT_DIR, "symbolic-qa-hub-latest.json"))
    || readJsonSafe(path.join(ROOT, "reports", "symbolic-qa-hub-latest.json"))
    || {};
  const repomap = readJsonSafe(path.join(REPORT_DIR, "repomap-background-latest.json"))
    || readJsonSafe(path.join(ROOT, "reports", "repomap-background-latest.json"))
    || {};
  const readiness = readJsonSafe(path.join(REPORT_DIR, "repo-readiness-pulse-latest.json"))
    || readJsonSafe(path.join(ROOT, "reports", "repo-readiness-pulse-latest.json"))
    || {};

  const topFeatures = Array.isArray(symbolic.features)
    ? symbolic.features.slice(0, 8).map((f) => ({
        key: f.feature_key,
        title: f.title,
        top_symbols: Array.isArray(f.top_symbols)
          ? f.top_symbols.slice(0, 5).map((s) => ({
              repo_key: s.repo_key,
              symbol_id: s.symbol_id,
              symbol_file: s.symbol_file,
              score: s.score,
            }))
          : [],
      }))
    : [];

  const repoMaps = Array.isArray(repomap.repos)
    ? repomap.repos.slice(0, 80).map((r) => ({
        repo: r.repo,
        ok: Boolean(r.ok),
        output: r.output,
      }))
    : [];

  const weakestRepos = Array.isArray(readiness.repos)
    ? readiness.repos
        .slice()
        .sort((a, b) => Number(a?.score?.total || 0) - Number(b?.score?.total || 0))
        .slice(0, 15)
        .map((r) => ({
          repo: r.repo,
          total_score: Number(r?.score?.total || 0),
          reasons: Array.isArray(r.reasons) ? r.reasons : [],
          index_age_hours: Number(r?.index?.age_hours || 0),
          repomap_age_hours: Number(r?.repomap?.age_hours || 0),
        }))
    : [];

  return {
    generated_at: new Date().toISOString(),
    symbolic_qa: {
      generated_at: symbolic.generated_at || null,
      repos_total: Number(symbolic.repos_total || 0),
      repos_indexed: Number(symbolic.repos_indexed || 0),
      features_total: Array.isArray(symbolic.features) ? symbolic.features.length : 0,
      top_features: topFeatures,
    },
    repomap: {
      generated_at: repomap.generated_at || null,
      ok: Boolean(repomap.ok),
      repos_total: Array.isArray(repomap.repos) ? repomap.repos.length : 0,
      repos: repoMaps,
    },
    readiness: {
      generated_at: readiness.generated_at || null,
      repos_total: Number(readiness.repos_total || 0),
      min_score: Number(readiness.min_score || 0),
      below_threshold: Number(readiness?.summary?.below_threshold || 0),
      remediations_queued: Number(readiness?.summary?.remediations_queued || 0),
      weakest_repos: weakestRepos,
    },
  };
}

function writeKnowledge(knowledge) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(SHARED_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportPath = path.join(REPORT_DIR, `${stamp}-index-knowledge.json`);
  const latestPath = path.join(REPORT_DIR, "index-knowledge-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify(knowledge, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(knowledge, null, 2));

  const md = [
    "# Shared Index Knowledge",
    "",
    `- generated_at: ${knowledge.generated_at}`,
    `- symbolic repos indexed: ${knowledge.symbolic_qa.repos_indexed}/${knowledge.symbolic_qa.repos_total}`,
    `- repomap repos: ${knowledge.repomap.repos_total}`,
    `- readiness below threshold: ${knowledge.readiness.below_threshold}`,
    `- remediations queued: ${knowledge.readiness.remediations_queued}`,
    "",
    "## Weakest Repos",
    "",
    ...(knowledge.readiness.weakest_repos.length
      ? knowledge.readiness.weakest_repos.map((r) =>
          `- ${r.repo}: score=${r.total_score} reasons=${(r.reasons || []).join(",") || "n/a"}`
        )
      : ["- none"]),
    "",
    "## Top Features",
    "",
    ...(knowledge.symbolic_qa.top_features.length
      ? knowledge.symbolic_qa.top_features.map((f) =>
          `- ${f.key}: ${(f.top_symbols || []).slice(0, 3).map((s) => s.symbol_id).join(" | ") || "no symbols"}`
        )
      : ["- none"]),
    "",
  ].join("\n");

  const sharedPath = path.join(SHARED_DIR, "INDEX-KNOWLEDGE-LATEST.md");
  fs.writeFileSync(sharedPath, md);

  return { reportPath, latestPath, sharedPath };
}

function main() {
  const dryRun = has("--dry-run");
  const strict = String(arg("--strict", process.env.INDEX_SYNC_STRICT || "true")).toLowerCase() !== "false";
  const minScore = Math.max(1, Number(arg("--min-score", process.env.INDEX_SYNC_MIN_SCORE || "80")) || 80);

  const steps = [];
  steps.push(runStep("mcp_health", "npm run -s mcp:health"));
  steps.push(runStep("repomap_background", "npm run -s repo:map:background"));
  steps.push(runStep("symbolic_qa_hub", "npm run -s qa:symbolic:hub"));
  steps.push(
    runStep(
      "repo_readiness",
      `node ./scripts/repo-readiness-pulse.js --min-score ${minScore}${dryRun ? " --dry-run" : ""}`
    )
  );

  const knowledge = buildKnowledge();
  const paths = writeKnowledge(knowledge);

  const failures = steps.filter((s) => !s.ok);
  const result = {
    ok: strict ? failures.length === 0 : true,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    strict,
    min_score: minScore,
    steps,
    failures: failures.map((f) => ({ name: f.name, code: f.code })),
    knowledge: {
      file: paths.latestPath,
      shared_markdown: paths.sharedPath,
      symbolic_repos_indexed: knowledge.symbolic_qa.repos_indexed,
      readiness_below_threshold: knowledge.readiness.below_threshold,
    },
  };

  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportPath = path.join(REPORT_DIR, `${stamp}-openclaw-index-sync-agent.json`);
  const latestPath = path.join(REPORT_DIR, "openclaw-index-sync-agent-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify({ ...result, report: { reportPath, latestPath } }, null, 2));
  if (!result.ok) process.exit(1);
}

main();

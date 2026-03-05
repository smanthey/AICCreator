#!/usr/bin/env node
"use strict";

/**
 * Convergence runner: drive repos toward their archetype completion contract.
 * 1) Load targets (repo + archetype) from config/convergence-targets.json (or .local / env).
 * 2) Optionally index workspace + target repos.
 * 3) Loop: run gap analysis for each target repo; evaluate completion contract per archetype;
 *    if any unsatisfied, run research agenda (optional) and builder-gap-pulse for those repos; repeat.
 * Stops when all targets satisfy their contract or max iterations.
 *
 * Usage:
 *   node scripts/convergence-runner.js
 *   node scripts/convergence-runner.js --no-index
 *   node scripts/convergence-runner.js --max-iterations 10 --force-queue
 *   node scripts/convergence-runner.js --repos HowtoWatchStream-SmartKB,payclaw  (override targets)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CLAW_REPOS = process.env.CLAW_REPOS_ROOT || process.env.CLAW_REPOS || path.join(process.env.HOME || require("os").homedir(), "claw-repos");
const ROLLING_PATH = path.join(ROOT, "reports", "repo-completion-gap-rolling.json");
const TARGETS_PATH = path.join(ROOT, "config", "convergence-targets.json");
const TARGETS_LOCAL_PATH = path.join(ROOT, "config", "convergence-targets.local.json");
const { evaluateContract } = require("../config/completion-contract");

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return String(process.argv[i + 1] || "").trim() || fallback;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function run(cmd, args, opts = {}) {
  const cwd = opts.cwd || ROOT;
  const r = spawnSync(cmd, args, { cwd, env: process.env, stdio: opts.silent ? "pipe" : "inherit", encoding: "utf8", timeout: opts.timeout || 0 });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function runNode(script, args = [], opts = {}) {
  return run("node", [path.join(ROOT, "scripts", script), ...args], { ...opts, timeout: opts.timeout || 600000 });
}

function loadTargets() {
  const envPath = process.env.CONVERGENCE_TARGETS_PATH;
  const paths = [envPath, TARGETS_LOCAL_PATH, TARGETS_PATH].filter(Boolean);
  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        const list = data.targets || data;
        return Array.isArray(list) ? list : [];
      } catch (e) {
        console.warn("[convergence-runner] Failed to load", p, e.message);
      }
    }
  }
  return [];
}

function filterExisting(targets) {
  return targets.filter((t) => {
    const repoPath = path.join(CLAW_REPOS, t.repo);
    return fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory();
  });
}

function loadRollingByRepo() {
  let rolling = [];
  try {
    if (fs.existsSync(ROLLING_PATH)) {
      rolling = JSON.parse(fs.readFileSync(ROLLING_PATH, "utf8"));
    }
  } catch {
    return new Map();
  }
  const arr = Array.isArray(rolling) ? rolling : [rolling];
  const byRepo = new Map();
  for (const r of arr) {
    if (r.repo) byRepo.set(r.repo, r);
  }
  return byRepo;
}

function stepIndex(repoNames) {
  console.log("\n[convergence-runner] Step 1: Index workspace + target repos");
  const indexPaths = path.join(ROOT, "scripts", "index-paths-from-master.js");
  const pyScript = path.join(ROOT, "scripts", "jcodemunch-index-paths.py");
  const nodeOut = spawnSync("node", [indexPaths], { cwd: ROOT, env: process.env, stdio: "pipe", encoding: "utf8" });
  let paths = (nodeOut.stdout || "")
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const name of repoNames) {
    const repoPath = path.join(CLAW_REPOS, name);
    if (fs.existsSync(repoPath) && !paths.includes(repoPath)) paths.push(repoPath);
  }
  paths.push(ROOT);
  paths = [...new Set(paths)];
  const py = process.env.OPENCLAW_PYTHON || path.join(ROOT, ".venv-openclaw-tools", "bin", "python");
  if (!fs.existsSync(py)) {
    console.warn("[convergence-runner] Python/jCodeMunch not found, skip indexing");
    return { ok: true };
  }
  const r = spawnSync(py, [pyScript, ...paths], { cwd: ROOT, env: process.env, stdio: "inherit", encoding: "utf8", timeout: 600000 });
  return { ok: r.status === 0 };
}

function stepGapForRepos(repoNames) {
  let allOk = true;
  for (const repo of repoNames) {
    console.log("\n[convergence-runner] Gap analysis:", repo);
    const res = runNode("repo-completion-gap-one.js", ["--repo", repo]);
    if (!res.ok) allOk = false;
  }
  return allOk;
}

function stepResearchAgenda() {
  console.log("\n[convergence-runner] Research agenda (--rolling)");
  runNode("builder-research-agenda.js", ["--rolling"]);
}

function stepPulse(repoNames, forceQueue) {
  const args = ["--repos", repoNames.join(",")];
  if (forceQueue) args.push("--force");
  console.log("\n[convergence-runner] Builder gap pulse:", args.join(" "));
  return runNode("builder-gap-pulse.js", args);
}

async function main() {
  const noIndex = hasArg("--no-index");
  const forceQueue = hasArg("--force-queue");
  const noResearch = hasArg("--no-research");
  const maxArg = getArg("--max-iterations", "15");
  const maxIterations = maxArg === "0" ? 0 : Math.max(1, parseInt(maxArg, 10) || 15);
  const reposOverride = getArg("--repos", null);

  let targets = loadTargets();
  if (reposOverride) {
    const list = reposOverride.split(",").map((s) => s.trim()).filter(Boolean);
    targets = list.map((repo) => ({ repo, archetype: "content_kb" }));
  }
  targets = filterExisting(targets);
  if (!targets.length) {
    console.error("[convergence-runner] No targets (or repos missing under CLAW_REPOS). Check config/convergence-targets.json and repo paths.");
    process.exit(2);
  }

  const repoNames = [...new Set(targets.map((t) => t.repo))];
  console.log("[convergence-runner] Targets:", targets.map((t) => `${t.repo}(${t.archetype})`).join(", "));

  if (!noIndex) {
    const ir = stepIndex(repoNames);
    if (!ir.ok) console.warn("[convergence-runner] Index step failed; continuing.");
  }

  let iteration = 0;
  do {
    iteration += 1;
    console.log("\n[convergence-runner] --- Iteration", iteration, "---");

    if (!stepGapForRepos(repoNames)) {
      console.error("[convergence-runner] Gap analysis failed for at least one repo.");
      process.exit(2);
    }

    const byRepo = loadRollingByRepo();
    const results = [];
    const unsatisfied = [];

    for (const t of targets) {
      const record = byRepo.get(t.repo);
      const out = evaluateContract(record || {}, t.archetype);
      results.push({ repo: t.repo, archetype: t.archetype, ...out });
      if (!out.satisfied) unsatisfied.push(t.repo);
    }

    console.log("\n[convergence-runner] Contract check:");
    for (const r of results) {
      console.log(`  ${r.repo} (${r.archetype}): ${r.satisfied ? "OK" : "FAIL — " + (r.reason || r.incomplete?.join(", "))}`);
    }

    if (unsatisfied.length === 0) {
      console.log("\n[convergence-runner] All targets satisfy completion contract.");
      process.exit(0);
    }

    if (!noResearch) stepResearchAgenda();
    const pulseOk = stepPulse([...new Set(unsatisfied)], forceQueue);
    if (!pulseOk) {
      console.error("[convergence-runner] Builder gap pulse failed.");
      process.exit(3);
    }

    const capHit = maxIterations > 0 && iteration >= maxIterations;
    if (capHit) {
      console.log("\n[convergence-runner] Max iterations reached; some targets still unsatisfied.");
      process.exit(1);
    }
  } while (true);
}

main().catch((err) => {
  console.error("[convergence-runner] Fatal:", err);
  process.exit(1);
});

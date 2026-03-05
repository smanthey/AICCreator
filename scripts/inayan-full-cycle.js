#!/usr/bin/env node
"use strict";

/**
 * Index the app, run Reddit/Git research from gaps, benchmark and compare, then update (queue fixes) until no gaps left.
 * 1) Index: workspace + all repos from master list (jCodeMunch).
 * 2) Gap analysis: repo-completion-gap-one --repo all (capability factory + feature benchmark, rolling report).
 * 3) Research agenda: builder-research-agenda --rolling (GitHub/Reddit search targets from gaps).
 * 4) Update: builder-gap-pulse --repos-from-context (queue repo_autofix + opencode_controller for repos with gaps).
 * With --until-done: repeat 2–4 until no repos have gaps or max iterations.
 * With --until-repo <name>: repeat 2–4 until that repo has no gaps (sections + issues + next_actions clear) or max iterations.
 *
 * Usage:
 *   node scripts/inayan-full-cycle.js
 *   node scripts/inayan-full-cycle.js --no-index
 *   node scripts/inayan-full-cycle.js --until-done
 *   node scripts/inayan-full-cycle.js --until-done --max-iterations 5
 *   node scripts/inayan-full-cycle.js --until-repo capture
 *   node scripts/inayan-full-cycle.js --until-repo capture --no-index --max-iterations 20
 *   node scripts/inayan-full-cycle.js --until-done --max-iterations 0   (no cap; stop only when all repos have no gaps)
 *   node scripts/inayan-full-cycle.js --until-repo HowtoWatchStream-SmartKB --force-queue  (queue builder tasks even if active)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ROLLING_PATH = path.join(ROOT, "reports", "repo-completion-gap-rolling.json");
const PYTHON_INDEX = process.env.OPENCLAW_PYTHON || path.join(ROOT, ".venv-openclaw-tools", "bin", "python");
const CLAW_REPOS = process.env.CLAW_REPOS_ROOT || process.env.CLAW_REPOS || path.join(process.env.HOME || require("os").homedir(), "claw-repos");

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
  const env = { ...process.env, ...opts.env };
  const r = spawnSync(cmd, args, { cwd, env, stdio: opts.silent ? "pipe" : "inherit", encoding: "utf8", timeout: opts.timeout || 0 });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function runNode(script, args = [], opts = {}) {
  return run("node", [path.join(ROOT, "scripts", script), ...args], { ...opts, timeout: opts.timeout || 600000 });
}

function loadRollingByRepo() {
  let rolling = [];
  try {
    if (fs.existsSync(ROLLING_PATH)) {
      const raw = fs.readFileSync(ROLLING_PATH, "utf8");
      rolling = JSON.parse(raw);
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

function repoHasGaps(record) {
  if (!record) return true;
  const incomplete = record.sections ? Object.values(record.sections).filter((v) => v && v.status !== "complete") : [];
  const hasActions = Array.isArray(record.next_actions) && record.next_actions.length > 0;
  const hasIssues = Array.isArray(record.issues) && record.issues.length > 0;
  return incomplete.length > 0 || hasActions || hasIssues;
}

function countReposWithGaps() {
  const byRepo = loadRollingByRepo();
  let withGaps = 0;
  for (const r of byRepo.values()) {
    if (repoHasGaps(r)) withGaps += 1;
  }
  return { count: withGaps, total: byRepo.size };
}

function stepIndex(untilRepo) {
  console.log("\n[inayan-full-cycle] Step 1: Index app (workspace + repos from master list" + (untilRepo ? " + --until-repo " + untilRepo + ")" : "") + ")");
  const indexPaths = path.join(ROOT, "scripts", "index-paths-from-master.js");
  const pyScript = path.join(ROOT, "scripts", "jcodemunch-index-paths.py");
  const nodeOut = spawnSync("node", [indexPaths], { cwd: ROOT, env: process.env, stdio: "pipe", encoding: "utf8" });
  if (nodeOut.status !== 0) {
    console.warn("[inayan-full-cycle] index-paths-from-master failed:", nodeOut.stderr?.slice(0, 300));
    return { ok: false };
  }
  let paths = nodeOut.stdout.split("\n").map((p) => p.trim()).filter(Boolean);
  if (untilRepo) {
    const repoPath = path.join(CLAW_REPOS, untilRepo);
    if (fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory() && !paths.includes(repoPath)) {
      paths.push(repoPath);
    }
  }
  if (!paths.length) {
    console.warn("[inayan-full-cycle] No paths to index (master list empty or no dirs?)");
    return { ok: true };
  }
  if (!fs.existsSync(PYTHON_INDEX)) {
    console.warn("[inayan-full-cycle] Python/jCodeMunch not found at", PYTHON_INDEX, "- skip indexing");
    return { ok: true };
  }
  const r = spawnSync(PYTHON_INDEX, [pyScript, ...paths], { cwd: ROOT, env: process.env, stdio: "inherit", encoding: "utf8", timeout: 600000 });
  return { ok: r.status === 0 };
}

function stepGapAnalysis(untilRepo) {
  const repoArg = untilRepo || "all";
  console.log("\n[inayan-full-cycle] Step 2: Gap analysis + benchmark (repo-completion-gap-one --repo " + repoArg + ")");
  return runNode("repo-completion-gap-one.js", ["--repo", repoArg]);
}

function stepResearchAgenda() {
  console.log("\n[inayan-full-cycle] Step 3: Reddit/Git research agenda from gaps (builder-research-agenda --rolling)");
  return runNode("builder-research-agenda.js", ["--rolling"]);
}

function stepUpdate(untilRepo, forceQueue) {
  const args = untilRepo ? ["--repos", untilRepo] : ["--repos-from-context"];
  if (forceQueue) args.push("--force");
  console.log("\n[inayan-full-cycle] Step 4: Queue fixes (builder-gap-pulse " + args.join(" ") + ")");
  return runNode("builder-gap-pulse.js", args);
}

async function main() {
  const noIndex = hasArg("--no-index");
  const untilDone = hasArg("--until-done");
  const untilRepo = getArg("--until-repo", null);
  const forceQueue = hasArg("--force-queue");
  const maxArg = getArg("--max-iterations", "10");
  const maxIterations = maxArg === "0" ? 0 : Math.max(1, parseInt(maxArg, 10) || 10);
  const noCap = maxIterations === 0;

  if (!noIndex) {
    const ir = stepIndex(untilRepo || null);
    if (!ir.ok) {
      console.error("[inayan-full-cycle] Index step failed; continuing with gap analysis.");
    }
  } else {
    console.log("[inayan-full-cycle] Skipping index (--no-index)");
  }

  let iteration = 0;
  do {
    iteration += 1;
    console.log("\n[inayan-full-cycle] --- Iteration", iteration, "---");

    const gapRes = stepGapAnalysis(untilRepo || null);
    if (!gapRes.ok) {
      console.error("[inayan-full-cycle] Gap analysis failed.");
      process.exit(2);
    }

    stepResearchAgenda(); // best-effort; report path is in reports/builder-research-agenda-latest.json

    const pulseRes = stepUpdate(untilRepo || null, forceQueue);
    if (!pulseRes.ok) {
      console.error("[inayan-full-cycle] Gap pulse (queue fixes) failed.");
      process.exit(3);
    }

    const byRepo = loadRollingByRepo();
    const { count, total } = countReposWithGaps();
    console.log("\n[inayan-full-cycle] Repos with gaps:", count, "/", total);

    const capHit = !noCap && iteration >= maxIterations;
    let shouldStop = capHit;
    if (untilRepo) {
      const rec = byRepo.get(untilRepo);
      const targetHasGaps = repoHasGaps(rec);
      if (!targetHasGaps) {
        console.log("[inayan-full-cycle] Target repo '" + untilRepo + "' has no gaps (sections + issues + next_actions clear).");
        shouldStop = true;
      } else {
        console.log("[inayan-full-cycle] Target repo '" + untilRepo + "' still has gaps; repeating (--until-repo).");
      }
    } else if (untilDone && count === 0) {
      console.log("[inayan-full-cycle] All repos have no gaps; stopping.");
      shouldStop = true;
    } else if (untilDone) {
      console.log("[inayan-full-cycle] Repeating gap → research → update (don't stop until all done, iteration", iteration + 1, "next).");
    }

    if (shouldStop) break;
  } while (true);

  const { count, total } = countReposWithGaps();
  console.log("\n[inayan-full-cycle] Done. Repos with gaps:", count, "/", total);
  if (untilRepo) {
    const byRepo = loadRollingByRepo();
    const rec = byRepo.get(untilRepo);
    const targetDone = !repoHasGaps(rec);
    console.log("[inayan-full-cycle] Target '" + untilRepo + "':", targetDone ? "100% (no gaps)" : "still has gaps");
  }
  process.exit(count > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[inayan-full-cycle] Fatal:", err);
  process.exit(1);
});

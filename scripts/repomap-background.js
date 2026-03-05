#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const REPOMAP_DIR = path.join(REPORT_DIR, "repomaps");
const REPOS_ROOT = process.env.CLAW_REPOS_ROOT || path.join(ROOT, "..", "claw-repos");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function slugifyRepo(input) {
  return String(input || "")
    .trim()
    .replace(/^local\//i, "")
    .replace(/\.git$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function runRepoMapper(repoPath, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (!fs.existsSync(outPath)) {
    fs.writeFileSync(outPath, "# Repo Map\n\n");
  }
  const py = fs.existsSync(path.join(ROOT, ".venv-openclaw-tools", "bin", "python"))
    ? path.join(ROOT, ".venv-openclaw-tools", "bin", "python")
    : "python3";
  const args = [
    "-m",
    "repo_mapper",
    repoPath,
    outPath,
    "--use-gitignore",
    "--ignore-dirs",
    "node_modules",
    ".git",
    ".next",
    ".venv-openclaw-tools",
  ];
  const res = spawnSync(py, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    timeout: 10 * 60 * 1000,
  });
  return {
    ok: Number(res.status ?? 1) === 0,
    code: Number(res.status ?? 1),
    stdout_tail: String(res.stdout || "").slice(-600),
    stderr_tail: String(res.stderr || "").slice(-600),
  };
}

function hoursSince(ms) {
  return Number(((Date.now() - Number(ms || 0)) / 3600000).toFixed(2));
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-repomap-background.json`);
  const latestPath = path.join(REPORT_DIR, "repomap-background-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const dryRun = has("--dry-run");
  const strictMissing = has("--strict-missing");
  const limit = Math.max(1, Number(arg("--limit", "200")) || 200);

  fs.mkdirSync(REPOMAP_DIR, { recursive: true });
  const { rows } = await pg.query(
    `SELECT id, client_name, local_path
       FROM managed_repos
      WHERE status='active'
      ORDER BY client_name ASC
      LIMIT $1`,
    [limit]
  );

  const repos = [];
  for (const row of rows) {
    const repoName = String(row.client_name || "").trim();
    const slug = slugifyRepo(repoName);
    const repoPath = String(row.local_path || "").trim() || path.join(REPOS_ROOT, slug);
    const outPath = path.join(REPOMAP_DIR, `${slug.toLowerCase()}-repomap.md`);
    if (!repoPath || !fs.existsSync(repoPath)) {
      repos.push({
        repo: `local/${slug.toLowerCase()}`,
        ok: false,
        reason: "repo_path_missing",
        repo_path: repoPath || null,
        output: outPath,
      });
      continue;
    }

    let mapper = { ok: true, code: 0, stdout_tail: "dry_run", stderr_tail: "" };
    if (!dryRun) mapper = runRepoMapper(repoPath, outPath);

    let ageHours = null;
    if (fs.existsSync(outPath)) {
      const stat = fs.statSync(outPath);
      ageHours = hoursSince(stat.mtimeMs);
    }
    repos.push({
      repo: `local/${slug.toLowerCase()}`,
      ok: mapper.ok,
      repo_path: repoPath,
      output: outPath,
      repomap_age_hours: ageHours,
      mapper_code: mapper.code,
      stderr_tail: mapper.stderr_tail,
    });
  }

  const report = {
    ok: repos.every((r) => r.ok || r.reason === "repo_path_missing"),
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    strict_missing: strictMissing,
    repos_total: repos.length,
    repos_ok: repos.filter((r) => r.ok).length,
    repos_failed: repos.filter((r) => !r.ok).length,
    repos_missing_paths: repos.filter((r) => r.reason === "repo_path_missing").length,
    repos,
  };
  if (strictMissing && report.repos_missing_paths > 0) {
    report.ok = false;
  }
  const paths = writeReport(report);
  console.log(JSON.stringify({ ...report, report: paths }, null, 2));
  if (!report.ok) process.exit(1);
}

main()
  .then(async () => {
    await pg.end();
  })
  .catch(async (err) => {
    console.error(`repomap-background failed: ${err.message}`);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

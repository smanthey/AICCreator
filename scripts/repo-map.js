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

async function resolveRepoPath(repoArg) {
  const raw = String(repoArg || "").trim();
  if (!raw) return null;
  if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;

  const slug = slugifyRepo(raw);
  const localCandidates = [
    path.join(REPOS_ROOT, slug),
    path.join(ROOT, slug),
    path.join(ROOT, "..", slug),
  ];
  for (const c of localCandidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    const { rows } = await pg.query(
      `SELECT local_path
         FROM managed_repos
        WHERE status = 'active'
          AND (
            LOWER(client_name) = $1
            OR LOWER(local_path) LIKE $2
          )
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [slug.toLowerCase(), `%/${slug.toLowerCase()}`]
    );
    const fromDb = String(rows[0]?.local_path || "").trim();
    if (fromDb && fs.existsSync(fromDb)) return fromDb;
  } catch {
    // DB lookup is optional.
  }

  return null;
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
    timeout: 15 * 60 * 1000,
  });
  return {
    ok: Number(res.status ?? 1) === 0,
    code: Number(res.status ?? 1),
    cmd: [py, ...args].join(" "),
    stdout_tail: String(res.stdout || "").slice(-1200),
    stderr_tail: String(res.stderr || "").slice(-1200),
  };
}

function writeReport(slug, report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-repo-map-${slug}.json`);
  const latestPath = path.join(REPORT_DIR, `repo-map-${slug}-latest.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const positional = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const repoArg = String(arg("--repo", positional[0] || ROOT)).trim();
  const explicitOutput = String(arg("--out", positional[1] || "")).trim();
  const dryRun = has("--dry-run");

  const repoPath = await resolveRepoPath(repoArg);
  if (!repoPath) throw new Error(`Unable to resolve repo path for "${repoArg}". Usage: node scripts/repo-map.js [--repo <repo|path>] [--out <file>]`);

  const slug = slugifyRepo(path.basename(repoPath));
  fs.mkdirSync(REPOMAP_DIR, { recursive: true });
  const outPath = explicitOutput || path.join(REPOMAP_DIR, `${slug}-repomap.md`);

  let mapper = {
    ok: true,
    code: 0,
    cmd: "dry_run",
    stdout_tail: "dry_run",
    stderr_tail: "",
  };
  if (!dryRun) mapper = runRepoMapper(repoPath, outPath);

  const report = {
    ok: mapper.ok,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    repo: `local/${slug.toLowerCase()}`,
    repo_path: repoPath,
    repo_map_path: outPath,
    mapper,
  };
  const paths = writeReport(slug, report);
  console.log(JSON.stringify({ ...report, report: paths }, null, 2));
  if (!report.ok) process.exit(1);
}

main()
  .then(async () => {
    await pg.end();
  })
  .catch(async (err) => {
    console.error(`repo-map failed: ${err.message}`);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

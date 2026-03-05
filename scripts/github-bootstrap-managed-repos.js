#!/usr/bin/env node
"use strict";

const path = require("path");
const os = require("os");
const https = require("https");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const USER = getArg("--user", process.env.GITHUB_ORG_OR_USER || "smanthey");
const LIMIT = parseInt(getArg("--limit", "200"), 10);
const DRY_RUN = ARGS.includes("--dry-run");
const REPOS_BASE = process.env.REPOS_BASE_PATH || path.join(os.homedir(), "claw-repos");

const pool = new Pool({
  host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST,
  port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
  database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
  user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
});

function getArg(flag, fallback) {
  const idx = ARGS.indexOf(flag);
  if (idx < 0 || idx + 1 >= ARGS.length) return fallback;
  return ARGS[idx + 1];
}

function fetchRepos(user, page = 1) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&page=${page}&sort=updated`);
    const headers = {
      "User-Agent": "claw-bootstrap/1.0",
      "Accept": "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`GitHub JSON parse error: ${err.message}`));
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error("GitHub timeout")));
    req.on("error", reject);
  });
}

async function main() {
  const repos = [];
  let page = 1;
  while (repos.length < LIMIT) {
    let batch = [];
    try {
      batch = await fetchRepos(USER, page);
    } catch (err) {
      console.error(`[github:bootstrap] fetch failed on page ${page}: ${err.message}`);
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  const trimmed = repos.slice(0, LIMIT);
  if (!trimmed.length) {
    console.log("[github:bootstrap] no repos found");
    await pool.end();
    return;
  }

  let inserted = 0;
  let updated = 0;
  for (const repo of trimmed) {
    const clientName = repo.name;
    const repoUrl = repo.clone_url;
    const localPath = path.join(REPOS_BASE, repo.name.replace(/[^a-zA-Z0-9._-]/g, "_"));
    const defaultBranch = repo.default_branch || "main";
    if (DRY_RUN) continue;

    // First reconcile any active row keyed by normalized client_name + local_path.
    // This avoids violating the partial unique index:
    // uq_managed_repos_active_client_path (lower(client_name), local_path) WHERE status='active'
    const byActivePath = await pool.query(
      `UPDATE managed_repos
       SET repo_url = $3,
           branch = $4,
           notes = $5
       WHERE status = 'active'
         AND lower(client_name) = lower($1)
         AND local_path = $2
       RETURNING id`,
      [clientName, localPath, repoUrl, defaultBranch, `github_bootstrap:${USER}`]
    );
    if (byActivePath.rowCount > 0) {
      updated += 1;
      continue;
    }

    const q = await pool.query(
      `INSERT INTO managed_repos (client_name, repo_url, branch, local_path, notes, status)
       VALUES ($1,$2,$3,$4,$5,'active')
       ON CONFLICT (repo_url)
       DO UPDATE SET client_name=EXCLUDED.client_name, branch=EXCLUDED.branch, local_path=EXCLUDED.local_path
       RETURNING (xmax = 0) AS inserted`,
      [clientName, repoUrl, defaultBranch, localPath, `github_bootstrap:${USER}`]
    );
    if (q.rows[0]?.inserted) inserted += 1;
    else updated += 1;
  }

  console.log(`[github:bootstrap] user=${USER} found=${trimmed.length} inserted=${inserted} updated=${updated} dry_run=${DRY_RUN}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[github:bootstrap] fatal:", err.message);
  await pool.end();
  process.exit(1);
});

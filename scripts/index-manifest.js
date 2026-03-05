#!/usr/bin/env node
"use strict";

/**
 * index-manifest.js
 * Writes reports/index-manifest.json: paths that would be (or were) indexed, timestamp,
 * and completed_repos from repo-completion-gap-rolling so downstream can skip rebuilding
 * work for repos that are already complete. Run after index:from-master or standalone.
 *
 * Usage:
 *   node scripts/index-manifest.js
 *   node scripts/index-manifest.js --after-index   (call after index:from-master in CI)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const MANIFEST_PATH = path.join(REPORTS_DIR, "index-manifest.json");
const ROLLING_PATH = path.join(REPORTS_DIR, "repo-completion-gap-rolling.json");
const CLAW_REPOS = process.env.CLAW_REPOS_ROOT || process.env.CLAW_REPOS || path.join(process.env.HOME || require("os").homedir(), "claw-repos");

const { loadMasterList } = require("../config/repo-completion-master-list-loader");

function hasGaps(record) {
  if (!record) return true;
  const incomplete = record.sections ? Object.values(record.sections).filter((v) => v && v.status !== "complete") : [];
  const hasActions = Array.isArray(record.next_actions) && record.next_actions.length > 0;
  const hasIssues = Array.isArray(record.issues) && record.issues.length > 0;
  return incomplete.length > 0 || hasActions || hasIssues;
}

function main() {
  const master = loadMasterList();
  const names = [...new Set([...(master.priority_repos || []), ...(master.additional_repos || [])])];
  const paths = [ROOT];
  for (const name of names) {
    const p = path.join(CLAW_REPOS, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) paths.push(p);
  }

  let completed_repos = [];
  try {
    if (fs.existsSync(ROLLING_PATH)) {
      const rolling = JSON.parse(fs.readFileSync(ROLLING_PATH, "utf8"));
      const list = Array.isArray(rolling) ? rolling : [rolling];
      const byRepo = new Map();
      for (const r of list) {
        if (!r.repo) continue;
        const existing = byRepo.get(r.repo);
        const completedAt = r.completed_at || r.started_at;
        if (!existing || (completedAt && (!existing.completed_at || completedAt > existing.completed_at)))
          byRepo.set(r.repo, r);
      }
      completed_repos = [...byRepo.entries()].filter(([, r]) => !hasGaps(r)).map(([repo]) => repo);
    }
  } catch {
    // ignore
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    paths,
    path_count: paths.length,
    repo_names: paths.slice(1).map((p) => path.basename(p)),
    completed_repos,
    rolling_path: ROLLING_PATH,
    note: "Run 'npm run index:from-master' to index paths. Use completed_repos to skip gap analysis for already-complete repos.",
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log("Wrote", MANIFEST_PATH);
  console.log("Paths:", manifest.path_count, "| Completed (no rebuild):", manifest.completed_repos.length, manifest.completed_repos.slice(0, 10).join(", ") + (manifest.completed_repos.length > 10 ? "..." : ""));
}

main();

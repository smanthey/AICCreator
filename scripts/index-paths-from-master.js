#!/usr/bin/env node
"use strict";

/**
 * Print paths to index: workspace root + each repo from master list (local override) that exists under CLAW_REPOS.
 * Usage: node scripts/index-paths-from-master.js
 *        node scripts/index-paths-from-master.js | .venv-openclaw-tools/bin/python scripts/jcodemunch-index-paths.py
 */

const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const CLAW_REPOS = process.env.CLAW_REPOS_ROOT || process.env.CLAW_REPOS || path.join(process.env.HOME || require("os").homedir(), "claw-repos");

const { loadMasterList } = require("../config/repo-completion-master-list-loader");

const master = loadMasterList();
const names = [...new Set([...(master.priority_repos || []), ...(master.additional_repos || [])])];
const existing = names.filter((name) => {
  const p = path.join(CLAW_REPOS, name);
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
});

console.log(ROOT);
for (const name of existing) {
  console.log(path.join(CLAW_REPOS, name));
}

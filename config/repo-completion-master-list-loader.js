"use strict";

/**
 * Load repo-completion master list. Premade/template repo: no real repo names in git.
 * Resolution order: REPO_COMPLETION_MASTER_LIST_PATH env → repo-completion-master-list.local.json → repo-completion-master-list.json.
 * @module config/repo-completion-master-list-loader
 */

const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname);
const DEFAULT_PATH = path.join(CONFIG_DIR, "repo-completion-master-list.json");
const LOCAL_PATH = path.join(CONFIG_DIR, "repo-completion-master-list.local.json");

function getMasterListPath() {
  const envPath = process.env.REPO_COMPLETION_MASTER_LIST_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(LOCAL_PATH)) return LOCAL_PATH;
  return DEFAULT_PATH;
}

function loadMasterList() {
  const p = getMasterListPath();
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { priority_repos: [], additional_repos: [], best_case_sources: {} };
  }
}

module.exports = { getMasterListPath, loadMasterList, LOCAL_PATH, DEFAULT_PATH };

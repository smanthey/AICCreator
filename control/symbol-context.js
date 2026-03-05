"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  inferSymbolDomainsFromFiles,
  mapDomainsToWorkerHints,
  scoreChangeImpact,
  generateTestTargets,
  compactSymbolContext,
} = require("./change-impact");

const HOME = process.env.HOME || os.homedir();
const INDEX_DIR = path.join(HOME, ".code-index");
const FOLDER_MAP_PATH = path.join(INDEX_DIR, "_folder-map.json");
const ROOT = path.join(__dirname, "..");
const EXEMPLAR_REPOS_PATH = path.join(ROOT, "data", "exemplar-repos.json");

const EXEMPLAR_REPOS_BASELINE = [
  "local/autopay_ui",
  "local/CaptureInbound",
  "local/capture",
  "local/veritap_2026",
];

function getExemplarRepos() {
  try {
    const data = JSON.parse(fs.readFileSync(EXEMPLAR_REPOS_PATH, "utf8"));
    if (Array.isArray(data.context_repos) && data.context_repos.length > 0) {
      const set = new Set(EXEMPLAR_REPOS_BASELINE);
      for (const r of data.context_repos) {
        if (r && typeof r === "string") set.add(r);
      }
      return [...set];
    }
  } catch {
    // no file or invalid
  }
  return EXEMPLAR_REPOS_BASELINE;
}

const EXEMPLAR_REPOS = getExemplarRepos();

const CONTEXT_TASK_TYPES = new Set([
  "opencode_controller",
  "repo_autofix",
  "site_fix_plan",
  "dev_pipeline_run",
  "github_repo_audit",
  "security_sweep",
]);

const _cache = new Map();

function safeReadJSON(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function loadFolderMap() {
  return safeReadJSON(FOLDER_MAP_PATH) || {};
}

function repoKeyToIndexPath(repoKey) {
  return path.join(INDEX_DIR, `${String(repoKey).replace(/\//g, "-")}.json`);
}

function loadIndex(repoKey) {
  const key = String(repoKey || "").trim();
  if (!key) return null;
  const fp = repoKeyToIndexPath(key);
  let stat;
  try {
    stat = fs.statSync(fp);
  } catch {
    return null;
  }
  const cached = _cache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
  const data = safeReadJSON(fp);
  if (!data) return null;
  _cache.set(key, { mtimeMs: stat.mtimeMs, data });
  return data;
}

function detectRepoKey(payload = {}) {
  const direct = [
    payload.repo,
    payload.repo_key,
    payload.repo_slug,
    payload.target_repo,
  ].find((v) => typeof v === "string" && v.trim().length > 0);
  if (direct) {
    const d = direct.trim();
    if (d.startsWith("local/")) return d;
    if (d.includes("/")) return d;
    return `local/${d}`;
  }

  const candidatePath = [
    payload.repo_path,
    payload.local_path,
    payload.path,
  ].find((v) => typeof v === "string" && v.trim().length > 0);
  if (!candidatePath) return null;

  const abs = path.resolve(candidatePath);
  const folderMap = loadFolderMap();
  const match = Object.entries(folderMap).find(([, mappedPath]) => {
    const mp = path.resolve(String(mappedPath || ""));
    return abs.startsWith(mp);
  });
  if (match) return match[0];

  const bn = path.basename(abs);
  return `local/${bn}`;
}

function tokenizeQuery(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_./ -]/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.length >= 3)
    .slice(0, 20);
}

function deriveQuery(taskType, title, payload = {}) {
  const src = [
    payload.objective,
    payload.reason,
    payload.topic,
    payload.pattern,
    payload.checks_failed && Array.isArray(payload.checks_failed) ? payload.checks_failed.join(" ") : "",
    title,
    taskType,
  ]
    .filter(Boolean)
    .join(" ");
  return src.slice(0, 600);
}

function scoreSymbol(sym, tokens) {
  if (!sym || !tokens.length) return 0;
  const hay = [
    sym.name,
    sym.qualified_name,
    sym.signature,
    sym.summary,
    sym.docstring,
    sym.file,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

function topSymbols(index, query, limit = 8) {
  const symbols = Array.isArray(index?.symbols) ? index.symbols : [];
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];
  return symbols
    .map((s) => ({ s, score: scoreSymbol(s, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({
      id: x.s.id,
      name: x.s.name,
      file: x.s.file,
      kind: x.s.kind,
      line: x.s.line,
    }));
}

function repoNameFromKey(repoKey) {
  const n = String(repoKey || "").replace(/^local\//, "");
  return path.basename(n);
}

function loadRepoMapExcerpt(repoKey) {
  const base = repoNameFromKey(repoKey);
  const candidates = [
    path.join(ROOT, "reports", "repomaps", `${base}-repomap.md`),
    path.join(ROOT, "reports", `${base}-repomap.md`),
  ];
  for (const fp of candidates) {
    try {
      const raw = fs.readFileSync(fp, "utf8");
      return raw.slice(0, 1400);
    } catch {}
  }
  return null;
}

function inferEntrypoints(index) {
  const files = Array.isArray(index?.source_files) ? index.source_files : [];
  const preferred = files.filter((f) =>
    /(server\/src\/(server|cli|webhooks|electron)\.ts|control\/dispatcher\.js|workers\/worker\.js|scripts\/.*\.js)$/i.test(f)
  );
  const selected = preferred.length ? preferred.slice(0, 8) : files.slice(0, 8);
  return selected;
}

function bestSourceHints(query) {
  const hints = [];
  for (const repo of EXEMPLAR_REPOS) {
    const idx = loadIndex(repo);
    if (!idx) continue;
    const symbols = topSymbols(idx, query, 3);
    for (const s of symbols) {
      hints.push({
        repo,
        symbol_id: s.id,
        file: s.file,
        name: s.name,
      });
    }
  }
  return hints.slice(0, 3);
}

function buildSymbolContextPack({ taskType, title, payload }) {
  try {
    const data = payload && typeof payload === "object" ? payload : {};
    if (!CONTEXT_TASK_TYPES.has(String(taskType || "")) && !data.repo && !data.repo_path) {
      return null;
    }
    const repoKey = detectRepoKey(data);
    if (!repoKey) return null;
    const index = loadIndex(repoKey);
    if (!index) return null;

    const query = deriveQuery(taskType, title, data);
    const dependentSymbols = topSymbols(index, query, 8);
    const entrypoints = inferEntrypoints(index);
    const repomap = loadRepoMapExcerpt(repoKey);
    const reuse = bestSourceHints(query);
    const symbolFiles = dependentSymbols.map((s) => s.file).filter(Boolean);
    const entryFiles = (entrypoints || []).filter(Boolean);
    const changedFiles = Array.isArray(data.changed_files) && data.changed_files.length
      ? data.changed_files.map((f) => String(f || ""))
      : Array.from(new Set([...symbolFiles, ...entryFiles])).slice(0, 20);
    const domains = inferSymbolDomainsFromFiles(changedFiles);
    const workerHints = mapDomainsToWorkerHints(domains);
    const impact = scoreChangeImpact({
      changedFiles,
      dependentSymbols,
      entrypoints,
    });
    const testTargets = generateTestTargets({
      changedFiles,
      domains,
    });
    const promptCompression = compactSymbolContext({
      dependentSymbols,
    });

    return {
      repo_key: repoKey,
      query,
      entrypoints,
      changed_files: changedFiles,
      domains,
      worker_hints: workerHints,
      change_impact: impact,
      test_targets: testTargets,
      prompt_compression: promptCompression,
      dependent_symbols: dependentSymbols,
      best_source_hints: reuse,
      repomap_excerpt: repomap,
      generated_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

module.exports = {
  buildSymbolContextPack,
  detectRepoKey,
};

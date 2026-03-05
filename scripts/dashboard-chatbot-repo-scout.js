#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const REPOS_BASE = process.env.REPOS_BASE_PATH || path.join(process.env.HOME || os.homedir(), "claw-repos");
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

const DEFAULT_QUERIES = [
  "topic:chatbot stars:>1000",
  "topic:llm stars:>1500",
  "topic:agent-framework stars:>500",
  "topic:workflow-automation stars:>3000",
  "topic:chat-ui stars:>300",
];

const SEED_REPOS = [
  "open-webui/open-webui",
  "danny-avila/LibreChat",
  "FlowiseAI/Flowise",
  "langflow-ai/langflow",
  "langgenius/dify",
  "motia-dev/motia",
  "LlamaIndexAI/LlamaIndexTS",
  "Significant-Gravitas/AutoGPT",
];

const KEYWORDS = [
  "chat",
  "chatbot",
  "dashboard",
  "agent",
  "workflow",
  "orchestr",
  "llm",
  "rag",
  "ui",
  "self-host",
  "monitor",
  "automation",
];

const FRAMEWORK_ONLY_TERMS = [
  "framework",
  "sdk",
  "runtime",
  "library",
  "toolkit",
  "orchestration engine",
  "engine",
];

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function numberArg(flag, fallback) {
  const n = Number(arg(flag, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function toSlug(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function localDirName(repoUrl) {
  const base = String(repoUrl || "").replace(/\.git$/i, "").split("/").pop() || "repo";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "repo";
}

function run(cmd, args, cwd = ROOT, timeout = 600000) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout, env: process.env });
  return {
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function curlJson(url, token) {
  const headers = [
    "-H", "Accept: application/vnd.github+json",
    "-H", "User-Agent: claw-architect-repo-scout",
  ];
  if (token) {
    headers.push("-H", `Authorization: Bearer ${token}`);
  }
  const res = run("curl", ["-sS", ...headers, url], ROOT, 120000);
  if (!res.ok) {
    throw new Error(`curl_failed:${res.stderr || res.stdout || res.code}`);
  }
  return JSON.parse(res.stdout);
}

function normalizeGitHubItem(item) {
  return {
    full_name: item.full_name,
    name: item.name,
    html_url: item.html_url,
    clone_url: item.clone_url,
    description: item.description || "",
    language: item.language || null,
    stars: Number(item.stargazers_count || 0),
    forks: Number(item.forks_count || 0),
    open_issues: Number(item.open_issues_count || 0),
    pushed_at: item.pushed_at || null,
    topics: Array.isArray(item.topics) ? item.topics : [],
  };
}

function isoDaysAgo(isoDate) {
  const ts = Date.parse(String(isoDate || ""));
  if (!Number.isFinite(ts)) return 9999;
  return (Date.now() - ts) / 86400000;
}

function keywordHits(text) {
  const hay = String(text || "").toLowerCase();
  return KEYWORDS.reduce((acc, kw) => acc + (hay.includes(kw) ? 1 : 0), 0);
}

function scoreRepo(item) {
  const stars = Number(item.stars || item.stargazers_count || 0);
  const forks = Number(item.forks || item.forks_count || 0);
  const issues = Number(item.open_issues || item.open_issues_count || 0);
  const days = isoDaysAgo(item.pushed_at);
  const recency = Math.max(0, 1 - Math.min(days, 365) / 365);
  const text = `${item.full_name || ""} ${item.description || ""} ${(item.topics || []).join(" ")}`;
  const relevanceHits = keywordHits(text);

  const score =
    Math.log10(Math.max(1, stars)) * 32 +
    Math.log10(Math.max(1, forks + 1)) * 8 +
    Math.min(20, relevanceHits * 3) +
    recency * 20 -
    Math.min(8, issues / 200);

  return Math.round(score * 100) / 100;
}

function isFrontendCodePath(pathStr) {
  const p = String(pathStr || "").toLowerCase();
  if (!p) return false;
  const extMatch = /\.(tsx|jsx|vue|svelte|html)$/i.test(p);
  const folderMatch = /(web|ui|frontend|client|dashboard|chat|app|pages|components|src\/app|src\/pages)/i.test(p);
  return extMatch && folderMatch;
}

function isLowSignalPath(pathStr) {
  const p = String(pathStr || "").toLowerCase();
  return /(^|\/)(docs?|readme|examples?|sample|cookbooks?|tutorial|notebooks?|tests?|__tests__|fixtures|migrations?|scripts|benchmarks?|metrics)(\/|$)/.test(p);
}

function detectTreeSignals(paths = []) {
  const signal = {
    total_files: paths.length,
    frontend_file_count: 0,
    strong_frontend_file_count: 0,
    dashboard_path_hits: 0,
    chat_path_hits: 0,
    module_route_hits: 0,
    frontend_config_hits: 0,
    docs_ui_mentions: 0,
    samples: {
      dashboard: [],
      chat: [],
      route: [],
    },
  };

  for (const raw of paths) {
    const p = String(raw || "");
    const pl = p.toLowerCase();
    if (!pl) continue;
    const lowSignal = isLowSignalPath(pl);

    const frontendCode = isFrontendCodePath(pl);
    const strongFrontend = frontendCode && !lowSignal;
    if (frontendCode) signal.frontend_file_count += 1;
    if (strongFrontend) signal.strong_frontend_file_count += 1;

    if (!lowSignal && /(dashboard|admin|console|studio|portal)/.test(pl) && frontendCode) {
      signal.dashboard_path_hits += 1;
      if (signal.samples.dashboard.length < 4) signal.samples.dashboard.push(p);
    }
    if (!lowSignal && /(chat|conversation|messages|inbox|assistant|webui|widget)/.test(pl) && frontendCode) {
      signal.chat_path_hits += 1;
      if (signal.samples.chat.length < 4) signal.samples.chat.push(p);
    }
    if (
      !lowSignal &&
      (
        /(^|\/)(app\/.*page\.(tsx|jsx|vue|svelte|html)|pages\/.*\.(tsx|jsx|vue|svelte|html))/.test(pl) ||
        /(^|\/)(web|ui|frontend|client)\/.*(routes|pages)\//.test(pl)
      )
    ) {
      signal.module_route_hits += 1;
      if (signal.samples.route.length < 4) signal.samples.route.push(p);
    }
    if (/(^|\/)(next\.config\.(js|mjs|ts)|vite\.config\.(js|mjs|ts)|nuxt\.config\.(js|ts)|angular\.json|web\/next\.config\.(js|ts)|ui\/vite\.config\.(js|ts))$/.test(pl)) {
      signal.frontend_config_hits += 1;
    }
    if (/readme|docs\//.test(pl) && /(dashboard|chat ui|web ui|webui)/.test(pl)) {
      signal.docs_ui_mentions += 1;
    }
  }

  return signal;
}

function fallbackSignalsFromMetadata(item) {
  const text = `${item.full_name || ""} ${item.description || ""} ${(item.topics || []).join(" ")}`.toLowerCase();
  const ui = detectTreeSignals([]);
  ui.docs_ui_mentions = 1;
  ui.dashboard_path_hits = /(dashboard|studio|portal|console|admin ui)/.test(text) ? 2 : 0;
  ui.chat_path_hits = /(chat ui|chatbot|webui|conversation|assistant ui|chat)/.test(text) ? 2 : 0;
  ui.module_route_hits = /(nextjs|react|vue|svelte|frontend|web app|web-ui)/.test(text) ? 1 : 0;
  ui.frontend_config_hits = /(nextjs|vite|react|vue|svelte|webui|chat-ui)/.test(text) ? 1 : 0;
  ui.frontend_file_count = ui.dashboard_path_hits + ui.chat_path_hits > 0 ? 12 : 0;
  return ui;
}

function frameworkOnlyBias(item) {
  const text = `${item.full_name || ""} ${item.description || ""} ${(item.topics || []).join(" ")}`.toLowerCase();
  return FRAMEWORK_ONLY_TERMS.reduce((acc, term) => acc + (text.includes(term) ? 1 : 0), 0);
}

function finalScore(baseScore, item, ui) {
  const uiScore =
    Math.min(28, Number(ui.dashboard_path_hits || 0) * 1.8) +
    Math.min(28, Number(ui.chat_path_hits || 0) * 1.8) +
    Math.min(20, Number(ui.module_route_hits || 0) * 2.2) +
    Math.min(14, Number(ui.frontend_config_hits || 0) * 4.5) +
    Math.min(10, Number(ui.strong_frontend_file_count || 0) / 35);

  const fwBias = frameworkOnlyBias(item);
  const frameworkPenalty = fwBias > 0 && uiScore < 18 ? Math.min(24, fwBias * 4.5) : 0;
  const total = Math.round((Number(baseScore || 0) + uiScore - frameworkPenalty) * 100) / 100;

  const uiPass =
    uiScore >= 22 &&
    Number(ui.frontend_config_hits || 0) >= 1 &&
    Number(ui.strong_frontend_file_count || 0) >= 60 &&
    Number(ui.dashboard_path_hits || 0) >= 1 &&
    Number(ui.chat_path_hits || 0) >= 3 &&
    Number(ui.module_route_hits || 0) >= 2;

  return {
    ui_score: Math.round(uiScore * 100) / 100,
    framework_penalty: Math.round(frameworkPenalty * 100) / 100,
    total_score: total,
    ui_pass: uiPass,
  };
}

function normalizeRepoUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("git@")) {
    return raw
      .replace(/^git@github(?:-claw)?:/i, "https://github.com/")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }
  return raw.replace(/\.git$/i, "").toLowerCase();
}

async function fetchRepoTreeSignals(fullName, token, cache) {
  const key = String(fullName || "").toLowerCase();
  if (!key) return { ok: false, reason: "missing_full_name", ui: detectTreeSignals([]) };
  if (cache.has(key)) return cache.get(key);

  try {
    const [ownerRaw, repoRaw] = String(fullName || "").split("/");
    const owner = encodeURIComponent(String(ownerRaw || "").trim());
    const repo = encodeURIComponent(String(repoRaw || "").trim());
    if (!owner || !repo) throw new Error("invalid_full_name");

    const meta = curlJson(`https://api.github.com/repos/${owner}/${repo}`, token);
    const branch = String(meta?.default_branch || "main");
    const tree = curlJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token
    );
    const paths = (Array.isArray(tree?.tree) ? tree.tree : [])
      .filter((n) => n && n.type === "blob")
      .map((n) => n.path)
      .filter(Boolean);
    const out = {
      ok: true,
      default_branch: branch,
      truncated: Boolean(tree?.truncated),
      ui: detectTreeSignals(paths),
    };
    cache.set(key, out);
    return out;
  } catch (err) {
    const out = {
      ok: false,
      reason: String(err?.message || "tree_probe_failed"),
      ui: detectTreeSignals([]),
    };
    cache.set(key, out);
    return out;
  }
}

async function loadManagedRepos() {
  const { rows } = await pg.query(
    `SELECT id, client_name, repo_url, local_path, status
       FROM managed_repos
      WHERE status = 'active'`
  );
  const byNormalizedUrl = new Map();
  for (const row of rows) {
    byNormalizedUrl.set(normalizeRepoUrl(row.repo_url), row);
  }
  return { rows, byNormalizedUrl };
}

function localRepoSignals(localPath, cache) {
  const key = String(localPath || "").trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  if (!fs.existsSync(key)) return null;

  const files = run(
    "rg",
    ["--files", key, "-g", "!node_modules", "-g", "!**/dist/**", "-g", "!**/build/**"],
    ROOT,
    180000
  );
  if (!files.ok) return null;
  const paths = files.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
  const out = detectTreeSignals(paths);
  cache.set(key, out);
  return out;
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload, priority = 8) {
  if (!isKnownTaskType(type)) throw new Error(`unknown_task_type:${type}`);
  validatePayload(type, payload);
  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", type, idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
    [id, type, JSON.stringify(payload), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, idempotencyKey };
}

async function registerRepo(candidate) {
  const clientName = toSlug(candidate.name) || toSlug(candidate.full_name.split("/").pop());
  const localPath = path.join(REPOS_BASE, localDirName(candidate.clone_url));
  const notes = `dashboard_chatbot_repo_scout score=${candidate.rank_score} stars=${candidate.stars} updated=${candidate.pushed_at}`;

  const { rows } = await pg.query(
    `INSERT INTO managed_repos (client_name, repo_url, branch, local_path, notes, status)
     VALUES ($1, $2, 'main', $3, $4, 'active')
     ON CONFLICT (repo_url)
     DO UPDATE SET client_name = EXCLUDED.client_name,
                   local_path = COALESCE(managed_repos.local_path, EXCLUDED.local_path),
                   notes = EXCLUDED.notes,
                   status = 'active'
     RETURNING id, client_name, repo_url, local_path`,
    [clientName, candidate.clone_url, localPath, notes]
  );
  return rows[0];
}

function gitCloneOrPull(repoUrl, localPath) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const gitDir = path.join(localPath, ".git");
  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(localPath, { recursive: true });
    const clone = run("git", ["clone", "--depth", "1", repoUrl, localPath], ROOT, 900000);
    return { action: "clone", ...clone };
  }

  const fetch = run("git", ["fetch", "--depth", "1", "origin"], localPath, 900000);
  if (!fetch.ok) return { action: "fetch", ...fetch };

  const reset = run("git", ["reset", "--hard", "FETCH_HEAD"], localPath, 900000);
  return { action: "pull", ...reset };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Dashboard Chatbot Repo Scout");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- queries: ${report.queries.join(" | ")}`);
  lines.push(`- candidates: ${report.candidates_total}`);
  lines.push(`- top_selected: ${report.top_selected.length}`);
  lines.push(`- applied: ${report.apply.applied}`);
  lines.push("");
  lines.push("## Top Candidates");
  lines.push("");
  for (const c of report.top_selected) {
    lines.push(`- ${c.full_name} | score=${c.rank_score} | stars=${c.stars} | managed=${c.already_managed ? "yes" : "no"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-dashboard-chatbot-repo-scout.json`);
  const latestJson = path.join(REPORT_DIR, "dashboard-chatbot-repo-scout-latest.json");
  const mdPath = path.join(REPORT_DIR, `${stamp}-dashboard-chatbot-repo-scout.md`);
  const latestMd = path.join(REPORT_DIR, "dashboard-chatbot-repo-scout-latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2));
  const md = buildMarkdown(report);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMd, md);

  return { jsonPath, latestJson, mdPath, latestMd };
}

async function main() {
  const apply = has("--apply");
  const clone = has("--clone");
  const queue = has("--queue");
  const limit = Math.max(1, Math.min(20, Math.floor(numberArg("--limit", 6))));
  const perQuery = Math.max(5, Math.min(30, Math.floor(numberArg("--per-query", 20))));
  const minStars = Math.max(100, Math.floor(numberArg("--min-stars", 1000)));
  const uiProbeLimit = Math.max(5, Math.min(120, Math.floor(numberArg("--ui-probe-limit", 35))));
  const requireUi = !has("--allow-framework-only");
  const queryCsv = String(arg("--queries", "")).trim();
  const queries = queryCsv ? queryCsv.split(",").map((x) => x.trim()).filter(Boolean) : DEFAULT_QUERIES;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

  const discovered = [];
  for (const q of queries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perQuery}`;
    const data = curlJson(url, token);
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      if (item.archived || item.disabled) continue;
      const stars = Number(item.stargazers_count || 0);
      if (stars < minStars) continue;
      discovered.push(normalizeGitHubItem(item));
    }
  }

  for (const fullName of SEED_REPOS) {
    try {
      const data = curlJson(`https://api.github.com/repos/${encodeURIComponent(fullName)}`, token);
      if (Number(data?.stargazers_count || 0) >= minStars) {
        discovered.push(normalizeGitHubItem(data));
      }
    } catch {
      // Seed lookup is best-effort only.
    }
  }

  const dedup = new Map();
  for (const item of discovered) {
    const key = String(item.full_name || "").toLowerCase();
    if (!key) continue;
    if (!dedup.has(key)) dedup.set(key, item);
  }

  const { rows: managedRows, byNormalizedUrl } = await loadManagedRepos();

  const preRanked = [...dedup.values()]
    .map((x) => {
      const baseScore = scoreRepo(x);
      const managed = byNormalizedUrl.has(normalizeRepoUrl(x.clone_url));
      return {
        ...x,
        base_score: baseScore,
        already_managed: managed,
      };
    })
    .sort((a, b) => b.base_score - a.base_score);

  const probeSet = new Set(preRanked.slice(0, uiProbeLimit).map((r) => String(r.full_name || "").toLowerCase()));
  const treeCache = new Map();
  const localCache = new Map();
  const ranked = [];
  for (const candidate of preRanked) {
    let tree = { ok: false, reason: "probe_skipped", ui: detectTreeSignals([]) };
    const managedRow = byNormalizedUrl.get(normalizeRepoUrl(candidate.clone_url));
    const localUi = managedRow?.local_path ? localRepoSignals(managedRow.local_path, localCache) : null;
    if (localUi) {
      tree = { ok: true, reason: "local_repo_scan", ui: localUi };
    }
    if (probeSet.has(String(candidate.full_name || "").toLowerCase())) {
      // Prefer local signals when available; otherwise probe GitHub tree.
      if (!localUi) {
        tree = await fetchRepoTreeSignals(candidate.full_name, token, treeCache);
      }
    }
    if (!tree.ok || Number(tree?.ui?.total_files || 0) === 0) {
      tree = {
        ok: false,
        reason: tree.reason || "metadata_fallback",
        ui: fallbackSignalsFromMetadata(candidate),
      };
    }
    const scored = finalScore(candidate.base_score, candidate, tree.ui);
    ranked.push({
      ...candidate,
      rank_score: scored.total_score,
      ui_score: scored.ui_score,
      framework_penalty: scored.framework_penalty,
      ui_pass: scored.ui_pass,
      ui_probe_ok: tree.ok,
      ui_probe_reason: tree.reason || null,
      ui_signals: tree.ui,
    });
  }
  ranked.sort((a, b) => b.rank_score - a.rank_score);

  const eligible = requireUi ? ranked.filter((r) => r.ui_pass) : ranked;
  const top = eligible.slice(0, limit);
  const toApply = top.filter((x) => !x.already_managed);

  const applyResult = {
    apply_requested: apply,
    clone_requested: clone,
    queue_requested: queue,
    applied: 0,
    cloned_or_pulled: 0,
    queued: 0,
    registered: [],
    clone_results: [],
    queue_results: [],
  };

  if (apply) {
    if (queue) {
      await ensureRoutingColumns();
    }

    for (const candidate of toApply) {
      const reg = await registerRepo(candidate);
      applyResult.registered.push(reg);
      applyResult.applied += 1;

      let localPath = reg.local_path;
      if (clone) {
        const cloneResult = gitCloneOrPull(candidate.clone_url, localPath);
        applyResult.clone_results.push({
          repo: candidate.full_name,
          local_path: localPath,
          action: cloneResult.action,
          ok: cloneResult.ok,
          code: cloneResult.code,
          stderr_tail: cloneResult.stderr.slice(-500),
        });
        if (cloneResult.ok) {
          applyResult.cloned_or_pulled += 1;
          const sha = run("git", ["log", "-1", "--pretty=%H %s"], localPath, 120000).stdout.trim().slice(0, 120);
          await pg.query(
            `UPDATE managed_repos
                SET local_path = $1,
                    last_synced = NOW(),
                    last_commit = $2,
                    status = 'active'
              WHERE id = $3`,
            [localPath, sha || null, reg.id]
          );
        }
      }

      if (queue) {
        const localRepoKey = `local/${toSlug(reg.client_name || candidate.name)}`;
        const queued = [];
        queued.push(await createTaskIfNeeded("repo_index_autopatch", {
          repo: localRepoKey,
          repo_path: localPath,
          source: "dashboard_chatbot_repo_scout",
          reasons: ["external_benchmark", "dashboard_chatbot"],
          queue_opencode_after: false,
          objective: `Index and map ${candidate.full_name} for dashboard-chatbot feature benchmarking.`,
          force: false,
        }, 9));
        queued.push(await createTaskIfNeeded("opencode_controller", {
          repo: localRepoKey,
          source: "dashboard_chatbot_repo_scout",
          objective: `Compare ${localRepoKey} against existing dashboard chatbot lanes, extract reusable patterns, and implement production-safe upgrades with filesystem MCP + rg/local symbol-map indexing first (no jcodemunch).`,
          max_iterations: 2,
          quality_target: 90,
          auto_iterate: true,
          force_implement: true,
        }, 9));
        applyResult.queue_results.push({ repo: candidate.full_name, local_repo: localRepoKey, queued });
        applyResult.queued += queued.filter((q) => q.created).length;
      }
    }
  }

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    queries,
    min_stars: minStars,
    per_query: perQuery,
    ui_probe_limit: uiProbeLimit,
    require_ui: requireUi,
    limit,
    managed_repo_count: managedRows.length,
    candidates_total: ranked.length,
    eligible_total: eligible.length,
    excluded_framework_or_low_ui: Math.max(0, ranked.length - eligible.length),
    top_selected: top,
    excluded_preview: ranked
      .filter((r) => !eligible.includes(r))
      .slice(0, 20)
      .map((r) => ({
        repo: r.full_name,
        base_score: r.base_score,
        ui_score: r.ui_score,
        framework_penalty: r.framework_penalty,
        ui_pass: r.ui_pass,
      })),
    apply: applyResult,
  };

  const paths = writeReport(report);
  console.log(JSON.stringify({ ...report, report_paths: paths }, null, 2));
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

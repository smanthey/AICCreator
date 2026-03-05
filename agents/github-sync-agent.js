// agents/github-sync-agent.js
// Handles github_sync and github_repo_status task types.
//
// Manages all client website repos for the design firm.
// Each repo is registered in the managed_repos table.
//
// github_sync payload:
//   { repo_ids?: string[], all?: true, base_path?: "/path/to/repos" }
//   → clones or pulls each managed repo, updates last_synced + last_commit
//   → returns per-repo status
//
// github_repo_status payload:
//   { repo_ids?: string[], all?: true }
//   → returns current git status of each managed repo (no writes)
//
// github_add_repo payload:
//   { client_name, repo_url, branch?: "main", notes?: string }
//   → registers a new repo in managed_repos
//
// Environment:
//   GITHUB_TOKEN     — optional; used for private repos (HTTPS clone URL)
//   REPOS_BASE_PATH  — where to clone repos (default: ~/claw-repos)

"use strict";

const { spawnSync } = require("child_process");
const path    = require("path");
const fs      = require("fs");
const pg      = require("../infra/postgres");
const { register } = require("./registry");

// ─── Helpers ──────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getReposBase() {
  return process.env.REPOS_BASE_PATH
    || path.join(process.env.HOME || "/tmp", "claw-repos");
}

/** Run a git command in a directory; returns { stdout, stderr, code } */
function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    code:   result.status,
    error:  result.error,
  };
}

/** Resolve an HTTPS repo URL to inject a token if set */
function resolveUrl(repoUrl) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return repoUrl;
  if (repoUrl.startsWith("git@")) return repoUrl; // SSH — no token needed
  // Inject token into HTTPS URL: https://TOKEN@github.com/...
  return repoUrl.replace(/^https:\/\//, `https://${token}@`);
}

/** Derive a safe local directory name from a repo URL — strips path traversal chars */
function localDirName(repoUrl) {
  const base = repoUrl.replace(/\.git$/, "").split("/").pop();
  // Sanitize: allow only alphanumeric, hyphens, underscores, dots
  const safe = (base || "repo").replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "repo";
}

function hasAnyFile(localPath, candidates) {
  return candidates.some((p) => fs.existsSync(path.join(localPath, p)));
}

function detectRepoProfile(localPath) {
  const pkgPath = path.join(localPath, "package.json");
  const hasPackageJson = fs.existsSync(pkgPath);
  const hasNextConfig = hasAnyFile(localPath, [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
  ]);
  const hasAppRouter = fs.existsSync(path.join(localPath, "app"));
  const hasPlaywright = hasAnyFile(localPath, [
    "playwright.config.ts",
    "playwright.config.js",
    "tests/playwright",
  ]);
  const hasModules = hasAnyFile(localPath, [
    "packages",
    "apps",
  ]);
  const hasModuleManifestSchema = fs.existsSync(
    path.join(localPath, "schemas", "module-manifest.schema.json")
  );

  let packageName = null;
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      packageName = pkg.name || null;
    } catch (_) {
      packageName = null;
    }
  }

  return {
    package_name: packageName,
    has_package_json: hasPackageJson,
    has_next_config: hasNextConfig,
    has_app_router: hasAppRouter,
    has_playwright: hasPlaywright,
    has_module_layout: hasModules,
    has_module_manifest_schema: hasModuleManifestSchema,
  };
}

function normalizeRepoSelector(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith("local/") ? raw.slice("local/".length) : raw;
}

function repoMatchKeys(repo) {
  const keys = new Set();
  const client = String(repo.client_name || "").trim().toLowerCase();
  const localPath = String(repo.local_path || "").trim();
  const localBase = localPath ? path.basename(localPath).toLowerCase() : "";
  const repoUrl = String(repo.repo_url || "").trim().toLowerCase();
  const repoTail = repoUrl.replace(/\.git$/, "").split("/").pop() || "";

  if (client) {
    keys.add(client);
    keys.add(`local/${client}`);
  }
  if (localBase) {
    keys.add(localBase);
    keys.add(`local/${localBase}`);
  }
  if (repoTail) {
    keys.add(repoTail);
    keys.add(`local/${repoTail}`);
  }
  if (repoUrl) keys.add(repoUrl);
  if (repo.id) keys.add(String(repo.id).toLowerCase());
  return keys;
}

function repoMatchesSelector(repo, selector) {
  const normalized = normalizeRepoSelector(selector);
  if (!normalized) return false;
  const keys = repoMatchKeys(repo);
  if (keys.has(normalized) || keys.has(`local/${normalized}`)) return true;
  // Allow URL fragments and path suffix checks.
  const repoUrl = String(repo.repo_url || "").trim().toLowerCase();
  return repoUrl.includes(`/${normalized}`) || repoUrl.endsWith(normalized);
}

function splitRepoFilters(payload = {}) {
  const ids = [];
  const selectors = [];

  const pushFilter = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    if (UUID_RE.test(raw)) ids.push(raw);
    else selectors.push(raw);
  };

  for (const id of Array.isArray(payload.repo_ids) ? payload.repo_ids : []) pushFilter(id);
  const repo = payload.repo;
  if (Array.isArray(repo)) {
    for (const r of repo) pushFilter(r);
  } else {
    pushFilter(repo);
  }
  for (const r of Array.isArray(payload.repos) ? payload.repos : []) pushFilter(r);

  return {
    ids: [...new Set(ids)],
    selectors: [...new Set(selectors)],
  };
}

async function resolveRepos(payload = {}, options = {}) {
  const { defaultAll = true } = options;
  const { ids, selectors } = splitRepoFilters(payload);
  const wantAll = payload.all === true || (defaultAll && ids.length === 0 && selectors.length === 0);
  if (wantAll) {
    const res = await pg.query("SELECT * FROM managed_repos WHERE status = 'active' ORDER BY client_name");
    return res.rows;
  }

  const out = [];
  const seen = new Set();
  const pushRows = (rows) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  };

  if (ids.length) {
    const res = await pg.query("SELECT * FROM managed_repos WHERE id = ANY($1::uuid[])", [ids]);
    pushRows(res.rows);
  }

  if (selectors.length) {
    const res = await pg.query("SELECT * FROM managed_repos WHERE status = 'active' ORDER BY client_name");
    const matched = res.rows.filter((repo) => selectors.some((s) => repoMatchesSelector(repo, s)));
    pushRows(matched);
  }

  return out;
}

// ─── Sync a single repo ───────────────────────────────────────

async function syncRepo(repo) {
  const base      = getReposBase();
  const localPath = repo.local_path || path.join(base, localDirName(repo.repo_url));
  const branch    = repo.branch || "main";
  const url       = resolveUrl(repo.repo_url);
  const exists    = fs.existsSync(path.join(localPath, ".git"));

  let action, lastCommit, status = "ok", details = "";

  if (!exists) {
    // Clone
    fs.mkdirSync(localPath, { recursive: true });
    const res = git(["clone", "--depth", "1", "--branch", branch, url, "."], localPath);
    if (res.code !== 0) {
      // Try without --branch (default branch)
      const res2 = git(["clone", "--depth", "1", url, "."], localPath);
      if (res2.code !== 0) {
        status  = "error";
        details = res2.stderr || res.stderr;
        return { repo_id: repo.id, client: repo.client_name, url: repo.repo_url, action: "clone", status, details };
      }
    }
    action = "cloned";
  } else {
    // Pull — for shallow repos, fetch then reset to FETCH_HEAD (more reliable than origin/branch ref)
    // because the remote-tracking ref may not exist until after fetch completes.
    const fetch = git(["fetch", "--depth", "1", "origin", branch], localPath);
    if (fetch.code !== 0) {
      // Branch name may differ (main vs master) — try without specifying branch
      const fetch2 = git(["fetch", "--depth", "1", "origin"], localPath);
      if (fetch2.code !== 0) {
        status  = "error";
        details = fetch2.stderr || fetch.stderr;
        return { repo_id: repo.id, client: repo.client_name, url: repo.repo_url, action: "pull", status, details };
      }
    }
    // Reset to FETCH_HEAD (always correct after any fetch, avoids stale remote-tracking ref issue)
    const reset = git(["reset", "--hard", "FETCH_HEAD"], localPath);
    if (reset.code !== 0) {
      status  = "error";
      details = reset.stderr;
      return { repo_id: repo.id, client: repo.client_name, url: repo.repo_url, action: "pull", status, details };
    }
    action = "pulled";
  }

  // Get last commit SHA + message
  const log = git(["log", "-1", "--pretty=%H %s"], localPath);
  const [sha, ...msgParts] = (log.stdout || "").split(" ");
  lastCommit = sha ? `${sha.slice(0, 8)} ${msgParts.join(" ").slice(0, 60)}` : null;

  // Update DB
  await pg.query(
    `UPDATE managed_repos SET local_path=$1, last_synced=now(), last_commit=$2 WHERE id=$3`,
    [localPath, lastCommit, repo.id]
  );

  console.log(`[github-sync] ${action} ${repo.client_name || repo.repo_url} → ${lastCommit || "?"}`);
  return { repo_id: repo.id, client: repo.client_name, url: repo.repo_url, local_path: localPath, action, last_commit: lastCommit, status };
}

// ─── Status of a single repo ──────────────────────────────────

async function statusRepo(repo) {
  const base      = getReposBase();
  const localPath = repo.local_path || path.join(base, localDirName(repo.repo_url));
  const exists    = fs.existsSync(path.join(localPath, ".git"));

  if (!exists) {
    return { repo_id: repo.id, client: repo.client_name, url: repo.repo_url, status: "not_cloned" };
  }

  const log     = git(["log", "-1", "--pretty=%H %s %ai"], localPath);
  const branch  = git(["rev-parse", "--abbrev-ref", "HEAD"], localPath);
  const dirty   = git(["status", "--porcelain"], localPath);
  const profile = detectRepoProfile(localPath);

  return {
    repo_id:       repo.id,
    client:        repo.client_name,
    url:           repo.repo_url,
    local_path:    localPath,
    branch:        branch.stdout || repo.branch,
    last_commit:   (log.stdout || "").slice(0, 80),
    uncommitted:   dirty.stdout ? dirty.stdout.split("\n").length : 0,
    profile,
    status:        "ok",
  };
}

async function collectRepoStatuses(payload = {}) {
  const repos = await resolveRepos(payload, { defaultAll: true });

  const results = [];
  for (const repo of repos) {
    results.push(await statusRepo(repo));
  }

  return {
    total_repos: repos.length,
    results,
    cost_usd: 0,
    model_used: "n/a",
  };
}

// ─── github_sync handler ──────────────────────────────────────

register("github_sync", async (payload) => {
  const { all = false } = payload;

  // Ensure clone base exists
  const base = getReposBase();
  fs.mkdirSync(base, { recursive: true });

  // Fetch repos from DB
  const repos = await resolveRepos(payload, { defaultAll: false });
  if (!all && repos.length === 0) {
    throw new Error("github_sync requires payload.all=true or repo filters (repo_ids/repo/repos)");
  }

  if (!repos.length) {
    return { repos_processed: 0, results: [], message: "No managed repos found. Add repos via github_add_repo." };
  }

  const results = [];
  for (const repo of repos) {
    try {
      const r = await syncRepo(repo);
      results.push(r);
    } catch (e) {
      results.push({ repo_id: repo.id, client: repo.client_name, url: repo.repo_url, status: "error", details: e.message });
    }
  }

  const ok      = results.filter((r) => r.status === "ok").length;
  const errored = results.filter((r) => r.status === "error").length;

  console.log(`[github-sync] sync complete: ${ok} ok, ${errored} errors`);
  return {
    repos_processed: repos.length,
    ok,
    errors: errored,
    results,
    base_path: base,
    cost_usd:  0,
    model_used: "n/a",
  };
});

// ─── github_repo_status handler ───────────────────────────────

register("github_repo_status", async (payload) => {
  return collectRepoStatuses(payload);
});

register("github_repo_audit", async (payload) => {
  const status = await collectRepoStatuses(payload);
  const results = (status.results || []).map((r) => {
    if (r.status !== "ok") return { ...r, compliance: "unknown", findings: ["repo not cloned"] };
    const findings = [];
    if (!r.profile?.has_next_config) findings.push("missing next.config.*");
    if (!r.profile?.has_app_router) findings.push("missing app/ (Next.js App Router)");
    if (!r.profile?.has_playwright) findings.push("missing Playwright harness");
    if (!r.profile?.has_module_manifest_schema) findings.push("missing schemas/module-manifest.schema.json");
    const compliance = findings.length === 0 ? "pass" : "fail";
    return { ...r, compliance, findings };
  });

  return {
    total_repos: results.length,
    pass: results.filter((r) => r.compliance === "pass").length,
    fail: results.filter((r) => r.compliance === "fail").length,
    results,
    cost_usd: 0,
    model_used: "n/a",
  };
});

// ─── github_add_repo handler ───────────────────────────────────

register("github_add_repo", async (payload) => {
  const { client_name, repo_url, branch = "main", local_path, notes } = payload;
  if (!repo_url) throw new Error("github_add_repo requires repo_url");

  const res = await pg.query(
    `INSERT INTO managed_repos (client_name, repo_url, branch, local_path, notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (repo_url) DO UPDATE SET client_name=$1, branch=$3, notes=COALESCE($5, managed_repos.notes)
     RETURNING id`,
    [client_name || null, repo_url, branch, local_path || null, notes || null]
  );

  const id = res.rows[0]?.id;
  console.log(`[github-sync] registered repo: ${repo_url} (${client_name}) → ${id}`);
  return { id, client_name, repo_url, branch, status: "registered", cost_usd: 0, model_used: "n/a" };
});

register("github_observability_scan", async (payload = {}) => {
  const script = path.join(__dirname, "../scripts/github-observability-scan.js");
  const args = [script];
  if (payload.repo) args.push("--repo", String(payload.repo));
  if (payload.limit) args.push("--limit", String(payload.limit));
  if (payload.dry_run) args.push("--dry-run");

  const res = spawnSync("node", args, { encoding: "utf8", timeout: 10 * 60 * 1000 });
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  if (res.status !== 0) {
    throw new Error(`github_observability_scan failed: ${stderr || stdout || "unknown error"}`);
  }
  return {
    status: "ok",
    dry_run: Boolean(payload.dry_run),
    output: stdout.split("\n").slice(-20).join("\n"),
    cost_usd: 0,
    model_used: "deterministic-scanner",
  };
});

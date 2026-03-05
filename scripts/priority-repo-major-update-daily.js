#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const REPOS_ROOT = process.env.REPOS_BASE_PATH || path.join(os.homedir(), "claw-repos");
const args = process.argv.slice(2);
const SOURCE = "priority_repo_major_update_daily";

const BOOTSTRAP_TARGETS = [
  {
    key: "quantfusion",
    clientName: "quantfusion",
    repo: "local/quantfusion",
    repoUrl: "https://github.com/smanthey/quantfusion.git",
    localPath: path.join(REPOS_ROOT, "quantfusion"),
    featureKey: "trading_reliability",
  },
  {
    key: "payclaw",
    clientName: "PayClaw",
    repo: "local/payclaw",
    repoUrl: "https://github.com/smanthey/payclaw.git",
    localPath: path.join(REPOS_ROOT, "payclaw"),
    featureKey: "payment_and_webhook_hardening",
  },
  {
    key: "cookiespass",
    clientName: "CookiesPass",
    repo: "local/CookiesPass",
    repoUrl: "https://github.com/smanthey/CookiesPass.git",
    localPath: path.join(REPOS_ROOT, "CookiesPass"),
    featureKey: "wallet_pass_and_loyalty_flow",
  },
  {
    key: "cookiespass_copy",
    clientName: "TempeCookiesPass",
    repo: "local/TempeCookiesPass",
    repoUrl: "https://github.com/smanthey/TempeCookiesPass.git",
    localPath: path.join(REPOS_ROOT, "TempeCookiesPass"),
    featureKey: "tempe_variant_stability",
  },
  {
    key: "clawpay",
    clientName: "ClawPay",
    repo: "local/clawpay",
    repoUrl: "https://github.com/smanthey/clawpay.git",
    localPath: path.join(REPOS_ROOT, "clawpay"),
    featureKey: "payment_collections_hardening",
  },
  {
    key: "captureinbound",
    clientName: "CaptureInbound",
    repo: "local/CaptureInbound",
    repoUrl: "https://github.com/smanthey/CaptureInbound.git",
    localPath: path.join(REPOS_ROOT, "CaptureInbound"),
    featureKey: "multitenant_number_integrity",
  },
  {
    key: "capture",
    clientName: "capture",
    repo: "local/capture",
    repoUrl: "https://github.com/smanthey/capture.git",
    localPath: path.join(REPOS_ROOT, "capture"),
    featureKey: "usage_report_release_hardening",
  },
  {
    key: "infinitedata",
    clientName: "infinitedata",
    repo: "local/infinitedata",
    repoUrl: "https://github.com/smanthey/infinitedata.git",
    localPath: path.join(REPOS_ROOT, "infinitedata"),
    featureKey: "data_pipeline_integrity",
  },
  {
    key: "inbound_cookies",
    clientName: "Inbound-cookies",
    repo: "local/Inbound-cookies",
    repoUrl: "https://github.com/smanthey/Inbound-cookies.git",
    localPath: path.join(REPOS_ROOT, "Inbound-cookies"),
    featureKey: "webhook_signature_enforcement",
  },
  {
    key: "autopay_ui",
    clientName: "autopay_ui",
    repo: "local/autopay_ui",
    repoUrl: "https://github.com/smanthey/autopay_ui.git",
    localPath: path.join(REPOS_ROOT, "autopay_ui"),
    featureKey: "flow_integrity_hardening",
  },
];

const PRIORITY_PATTERNS = String(
  process.env.PRIORITY_REPO_PATTERNS ||
    "quantfusion,cookiespass,tempecookiespass,payclaw,clawpay,captureinbound,capture,infinitedata,inbound-cookies,autopay_ui,roblox"
)
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function has(flag) {
  return args.includes(flag);
}

function runDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeRepo(repo) {
  const raw = String(repo || "").trim();
  if (!raw) return "";
  if (raw.startsWith("local/")) return raw;
  return `local/${raw}`;
}

function featureKeyFromRepo(repo) {
  const key = normalizeRepo(repo).slice("local/".length).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  if (key.includes("quantfusion")) return "trading_reliability";
  if (key.includes("cookiespass")) return "wallet_pass_and_loyalty_flow";
  if (key.includes("payclaw") || key.includes("clawpay")) return "payment_and_webhook_hardening";
  if (key.includes("roblox")) return "game_growth_quality_and_retention";
  return key ? `${key}_major_update` : "major_update";
}

function repoMatchesOnly(target, wanted) {
  const fields = [target.key, target.clientName, target.repo, target.localPath]
    .map((v) => String(v || "").toLowerCase());
  return [...wanted].some((w) => fields.some((f) => f.includes(w)));
}

function discoverGitRepos(rootPath) {
  const out = [];
  const root = String(rootPath || "").trim();
  if (!root || !fs.existsSync(root)) return out;
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const entry of entries) {
    const localPath = path.join(root, entry.name);
    if (!fs.existsSync(path.join(localPath, ".git"))) continue;
    const repo = normalizeRepo(entry.name);
    out.push({
      key: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      clientName: entry.name,
      repo,
      repoUrl: "",
      localPath,
      notes: "Auto-discovered local git repo",
      featureKey: featureKeyFromRepo(repo),
    });
  }
  return out;
}

function priorityHit(target) {
  const text = [target.key, target.clientName, target.repo, target.localPath].join(" ").toLowerCase();
  return PRIORITY_PATTERNS.some((p) => text.includes(p));
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
    [idempotencyKey, ACTIVE_TASK_STATUSES]
  );
  return rows.length > 0;
}

async function taskExistsForRepoDate(repo, date) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE type = 'opencode_controller'
        AND COALESCE(payload->>'source','') = $1
        AND COALESCE(payload->>'repo','') = $2
        AND COALESCE(payload->>'run_date','') = $3
      LIMIT 1`,
    [SOURCE, repo, date]
  );
  return rows.length > 0;
}

async function enqueueTask(type, payload, priority = 6, dryRun = false) {
  return enqueueOnce({
    type,
    payload,
    priority,
    dryRun,
    activeStatuses: ACTIVE_TASK_STATUSES,
  });
}

async function ensureManagedRepo(target, dryRun) {
  const { rows } = await pg.query(
    `SELECT id, client_name, repo_url, local_path, status
       FROM managed_repos
      WHERE lower(client_name) = lower($1)
      LIMIT 1`,
    [target.clientName]
  );

  if (rows.length > 0) {
    const row = rows[0];
    if (!dryRun) {
      await pg.query(
        `UPDATE managed_repos
            SET repo_url = $2,
                local_path = $3,
                branch = COALESCE(branch, 'main'),
                status = 'active'
          WHERE id = $1`,
        [row.id, target.repoUrl, target.localPath]
      );
    }
    return { action: "updated", id: row.id, client_name: target.clientName };
  }

  if (!dryRun) {
    const ins = await pg.query(
      `INSERT INTO managed_repos (client_name, repo_url, branch, local_path, notes, status)
       VALUES ($1, $2, 'main', $3, $4, 'active')
       RETURNING id`,
      [
        target.clientName,
        target.repoUrl,
        target.localPath,
        "Daily major-update lane. Requires meaningful code updates, commit, and push.",
      ]
    );
    return { action: "inserted", id: ins.rows[0].id, client_name: target.clientName };
  }

  return { action: "would_insert", client_name: target.clientName };
}

async function ensureBootstrapTargets(dryRun) {
  const out = [];
  for (const target of BOOTSTRAP_TARGETS) {
    // Only upsert if local path exists or this is a known top-priority seed.
    const localExists = fs.existsSync(target.localPath);
    if (!localExists && !priorityHit(target)) continue;
    // Avoid creating dead entries for unknown repos with no URL.
    if (!String(target.repoUrl || "").trim()) continue;
    out.push({ target: target.key, managed_repo: await ensureManagedRepo(target, dryRun) });
  }
  return out;
}

async function loadActiveTargets(maxTargets) {
  const { rows } = await pg.query(
    `SELECT client_name, repo_url, local_path, status, notes
       FROM managed_repos
      WHERE status = 'active'
      ORDER BY client_name ASC
      LIMIT $1`,
    [maxTargets]
  );
  return rows
    .map((r) => {
      const bn = path.basename(String(r.local_path || "").trim());
      const repo = normalizeRepo(bn || r.client_name || "");
      return {
        key: String(r.client_name || bn || repo).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        clientName: String(r.client_name || bn || repo),
        repo,
        repoUrl: String(r.repo_url || "").trim(),
        localPath: String(r.local_path || "").trim(),
        notes: String(r.notes || "").trim(),
        featureKey: featureKeyFromRepo(repo),
      };
    })
    .filter((t) => t.repo);
}

async function loadRepoFailureCounts(windowHours = 72) {
  const { rows } = await pg.query(
    `SELECT COALESCE(payload->>'repo','') AS repo,
            COUNT(*) FILTER (WHERE status IN ('FAILED','DEAD_LETTER'))::int AS failure_count,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_count
       FROM tasks
      WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
        AND COALESCE(payload->>'repo','') <> ''
      GROUP BY repo`,
    [windowHours]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.repo), {
      failure_count: Number(r.failure_count || 0),
      completed_count: Number(r.completed_count || 0),
    });
  }
  return map;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-priority-repo-major-update-daily.json`);
  const latestPath = path.join(REPORT_DIR, "priority-repo-major-update-daily-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const dryRun = has("--dry-run");
  const allGit = has("--all-git");
  const maxTargets = Math.max(1, Number(arg("--max-targets", "200")) || 200);
  const date = runDate();
  await ensureRoutingColumns();
  const bootstrap = await ensureBootstrapTargets(dryRun);
  let targets = await loadActiveTargets(maxTargets);
  const discoveredGitTargets = allGit ? discoverGitRepos(REPOS_ROOT) : [];
  if (discoveredGitTargets.length > 0) {
    targets = targets.concat(discoveredGitTargets);
  }

  const onlyArg = String(arg("--only", "")).trim();
  if (onlyArg) {
    const wanted = new Set(
      onlyArg
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
    );
    targets = targets.filter((t) => repoMatchesOnly(t, wanted));
  }

  if (targets.length === 0) {
    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      run_date: date,
      dry_run: dryRun,
      source: SOURCE,
      bootstrap_managed_repos: bootstrap,
      targets: [],
      created_count: 0,
      skipped_duplicates: 0,
      noop_reason: "no_matching_active_targets",
    };
    const paths = writeReport(report);
    console.log(
      JSON.stringify(
        {
          ok: true,
          run_date: date,
          dry_run: dryRun,
          targets: [],
          created_count: 0,
          skipped_duplicates: 0,
          noop_reason: "no_matching_active_targets",
          report: paths,
        },
        null,
        2
      )
    );
    return;
  }

  const seen = new Set();
  targets = targets.filter((t) => {
    if (seen.has(t.repo)) return false;
    seen.add(t.repo);
    return true;
  });

  const metricsByRepo = await loadRepoFailureCounts(72);
  targets.sort((a, b) => {
    const aPriority = priorityHit(a) ? 1 : 0;
    const bPriority = priorityHit(b) ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;

    const am = metricsByRepo.get(a.repo) || { failure_count: 0, completed_count: 0 };
    const bm = metricsByRepo.get(b.repo) || { failure_count: 0, completed_count: 0 };

    // "Close to finished" heuristic: fewer failures + proven recent completions.
    if (am.failure_count !== bm.failure_count) return am.failure_count - bm.failure_count;
    if (am.completed_count !== bm.completed_count) return bm.completed_count - am.completed_count;
    return a.repo.localeCompare(b.repo);
  });

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    run_date: date,
    dry_run: dryRun,
    all_git: allGit,
    source: SOURCE,
    bootstrap_managed_repos: bootstrap,
    discovered_git_repos: discoveredGitTargets.length,
    targets: [],
    created_count: 0,
    skipped_duplicates: 0,
  };

  for (const target of targets) {
    if (await taskExistsForRepoDate(target.repo, date)) {
      report.targets.push({
        key: target.key,
        repo: target.repo,
        skipped: "already_queued_today",
      });
      report.skipped_duplicates += 1;
      continue;
    }

    const metrics = metricsByRepo.get(target.repo) || { failure_count: 0, completed_count: 0 };
    const highPriority = priorityHit(target);
    const priority = highPriority ? 10 : 6;
    const objective =
      `Daily major-update mandate for ${target.repo}. ` +
      `Execute exactly one meaningful production update item, then move to the next repo. ` +
      `Run jCodeMunch indexing + symbol retrieval first, then repo_mapper when available, implement the chosen update, validate with targeted checks, and commit + push today. ` +
      `Prioritize completion velocity over broad refactors.`;

    const opencodeTask = await enqueueTask(
      "opencode_controller",
      {
        repo: target.repo,
        source: SOURCE,
        objective,
        run_date: date,
        all_git: allGit,
        feature_key: target.featureKey,
        max_iterations: 6,
        quality_target: 96,
        auto_iterate: true,
        force_implement: true,
        one_item_then_move_on: true,
        high_priority_lane: highPriority,
        close_to_finish_hint: metrics.failure_count <= 2 && metrics.completed_count > 0,
        commit_required: true,
        push_required: true,
      },
      priority,
      dryRun
    );

    if (opencodeTask.created) {
      report.created_count += 1;
    } else {
      report.skipped_duplicates += 1;
    }

    report.targets.push({
      key: target.key,
      repo: target.repo,
      priority,
      high_priority_lane: highPriority,
      repo_metrics_72h: metrics,
      task: opencodeTask,
    });
  }

  const paths = writeReport(report);
  console.log(
    JSON.stringify(
      {
        ok: true,
        run_date: date,
        dry_run: dryRun,
        targets: targets.map((t) => t.repo),
        created_count: report.created_count,
        skipped_duplicates: report.skipped_duplicates,
        report: paths,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[priority-repo-major-update-daily] fatal:", err.message || String(err));
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

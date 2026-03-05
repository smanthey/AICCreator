#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { notifyMonitoring } = require("../control/monitoring-notify");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const REPOMAP_DIR = path.join(REPORT_DIR, "repomaps");
const TREND_PATH = path.join(ROOT, "agent-state", "shared-context", "repo-readiness-trend.json");
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function hoursSince(ts) {
  if (!ts) return null;
  const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return null;
  return Number(((Date.now() - ms) / 3600000).toFixed(2));
}

function scoreFromAge(ageHours, full, stale) {
  if (ageHours == null) return 0;
  if (ageHours <= full) return 100;
  if (ageHours >= stale) return 0;
  const span = stale - full;
  const remain = stale - ageHours;
  return Math.max(0, Math.round((remain / span) * 100));
}

function scoreRepo(indexAgeHours, repomapAgeHours, coverageSignals) {
  const indexFresh = scoreFromAge(indexAgeHours, 24, 7 * 24);
  const repomapFresh = scoreFromAge(repomapAgeHours, 24, 7 * 24);
  const coverage = coverageSignals >= 3 ? 100 : coverageSignals === 2 ? 80 : coverageSignals === 1 ? 55 : 20;
  const total = Math.round(indexFresh * 0.4 + repomapFresh * 0.3 + coverage * 0.3);
  return {
    total,
    index: indexFresh,
    repomap: repomapFresh,
    coverage,
  };
}

function readJsonSafe(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonSafe(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function repomapPathForRepo(repoName) {
  const slug = String(repoName || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .toLowerCase();
  return path.join(REPOMAP_DIR, `${slug}-repomap.md`);
}

function normalizeRepoName(repoName) {
  return String(repoName || "").trim().toLowerCase();
}

function collapseManagedRepos(repos) {
  const grouped = new Map();
  for (const repo of repos) {
    const key = normalizeRepoName(repo.client_name);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(repo);
  }
  const collapsed = [];
  const duplicates = [];
  for (const [key, group] of grouped.entries()) {
    const sorted = group.slice().sort((a, b) => {
      const aPath = String(a.local_path || "").trim();
      const bPath = String(b.local_path || "").trim();
      const aExists = aPath && fs.existsSync(aPath) ? 1 : 0;
      const bExists = bPath && fs.existsSync(bPath) ? 1 : 0;
      if (aExists !== bExists) return bExists - aExists;
      return Number(b.id || 0) - Number(a.id || 0);
    });
    collapsed.push(sorted[0]);
    if (group.length > 1) {
      duplicates.push({
        repo: `local/${key}`,
        count: group.length,
        variants: group.map((r) => ({
          id: r.id,
          client_name: r.client_name,
          local_path: r.local_path || null,
        })),
      });
    }
  }
  return { collapsed, duplicates };
}

async function ensureRoutingColumns() {
  // Avoid long waits on DDL lock contention during validation runs.
  await pg.query(`SET lock_timeout = '1500ms'`);
  try {
    await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
    await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  } finally {
    await pg.query(`RESET lock_timeout`).catch(() => {});
  }
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

async function createTaskIfNeeded(type, payload, priority = 5, dryRun = false, options = {}) {
  const failOpenOnLockTimeout = Boolean(options.failOpenOnLockTimeout);
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (dryRun) {
    return {
      created: true,
      dry_run: true,
      skipped_duplicate_check: true,
      type,
      payload,
      idempotencyKey,
    };
  }
  try {
    if (await taskExists(idempotencyKey)) {
      return { created: false, reason: "duplicate_active", type, idempotencyKey };
    }
  } catch (err) {
    const reason = String(err?.message || "task_lookup_failed");
    if (failOpenOnLockTimeout && /lock timeout|canceling statement due to lock timeout/i.test(reason)) {
      return { created: false, reason: "lock_timeout", type, idempotencyKey };
    }
    throw err;
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  try {
    await pg.query(
      `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
       VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
      [id, type, JSON.stringify(payload || {}), priority, routing.queue, routing.required_tags, idempotencyKey]
    );
  } catch (err) {
    const reason = String(err?.message || "task_insert_failed");
    if (failOpenOnLockTimeout && /lock timeout|canceling statement due to lock timeout/i.test(reason)) {
      return { created: false, reason: "lock_timeout", type, idempotencyKey };
    }
    throw err;
  }
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, idempotencyKey };
}

function loadTrend() {
  const raw = readJsonSafe(TREND_PATH);
  if (raw && typeof raw === "object") return raw;
  return { updated_at: new Date(0).toISOString(), repos: {} };
}

function updateTrend(trend, repo, score, generatedAt) {
  trend.repos = trend.repos || {};
  const list = Array.isArray(trend.repos[repo]) ? trend.repos[repo] : [];
  list.push({ at: generatedAt, score });
  trend.repos[repo] = list.slice(-90);
}

function previousScore(trend, repo) {
  const list = Array.isArray(trend?.repos?.[repo]) ? trend.repos[repo] : [];
  if (list.length < 1) return null;
  return Number(list[list.length - 1]?.score ?? null);
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-repo-readiness-pulse.json`);
  const latestPath = path.join(REPORT_DIR, "repo-readiness-pulse-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const minScore = Math.max(1, Number(arg("--min-score", "80")) || 80);
  const alertDrop = Math.max(1, Number(arg("--alert-drop", "8")) || 8);
  const limitRaw = Number(arg("--limit", "0")) || 0;
  const limit = limitRaw > 0 ? Math.floor(limitRaw) : 0;
  const dryRun = has("--dry-run");
  const notifyRegressions = has("--notify-regressions");
  const skipLockDdl = has("--skip-lock-ddl");
  const validationMode = dryRun || skipLockDdl || limit > 0;
  const queryTimeoutMs = validationMode
    ? Math.max(2000, Number(arg("--query-timeout-ms", "8000")) || 8000)
    : 0;

  if (queryTimeoutMs > 0) {
    const rawQuery = pg.query.bind(pg);
    pg.query = (text, values) => {
      if (typeof text === "string") {
        return rawQuery({ text, values, query_timeout: queryTimeoutMs });
      }
      if (text && typeof text === "object" && !Object.prototype.hasOwnProperty.call(text, "query_timeout")) {
        return rawQuery({ ...text, query_timeout: queryTimeoutMs });
      }
      return rawQuery(text, values);
    };
  }

  if (validationMode) {
    // Session-level timeout is best-effort only under pooled connections.
    await pg.query(`SET statement_timeout = '8000ms'`).catch(() => {});
  }

  const ddl = {
    skipped: skipLockDdl,
    ok: true,
    reason: skipLockDdl ? "flag_skip_lock_ddl" : null,
  };
  if (!skipLockDdl) {
    try {
      await ensureRoutingColumns();
    } catch (err) {
      ddl.ok = false;
      ddl.reason = String(err?.message || "ddl_failed");
      if (/lock timeout|canceling statement due to lock timeout/i.test(ddl.reason)) {
        ddl.reason = "lock_timeout";
      } else {
        throw err;
      }
    }
  }
  const generatedAt = new Date().toISOString();

  const { rows: reposRaw } = await pg.query(
    `SELECT id, client_name, local_path, status
       FROM managed_repos
      WHERE status='active'
      ORDER BY client_name ASC`
  );
  const { collapsed: reposAll, duplicates: duplicateRepos } = collapseManagedRepos(reposRaw);
  const repos = limit > 0 ? reposAll.slice(0, limit) : reposAll;

  const trend = loadTrend();
  const remediations = [];
  const regressions = [];
  const rows = [];
  const indexTargets = [];

  for (const repo of repos) {
    const repoName = String(repo.client_name || "").trim();
    const repoKey = `local/${normalizeRepoName(repoName)}`;
    const localPath = String(repo.local_path || "").trim();
    try {

      const idxRun = await pg.query(
        `SELECT finished_at, started_at
           FROM index_runs
          WHERE root_path = $1
          ORDER BY finished_at DESC NULLS LAST, started_at DESC NULLS LAST
          LIMIT 1`,
        [localPath]
      );
      const indexFinished = idxRun.rows[0]?.finished_at || idxRun.rows[0]?.started_at || null;
      const indexAgeHours = hoursSince(indexFinished);

      const repomapPath = repomapPathForRepo(repoName);
      const repomapMtime = fs.existsSync(repomapPath) ? fs.statSync(repomapPath).mtimeMs : null;
      const repomapAgeHours = repomapMtime ? hoursSince(repomapMtime) : null;

      const coverage = await pg.query(
        `SELECT
           COUNT(*) FILTER (
             WHERE type = 'opencode_controller'
               AND created_at >= NOW() - INTERVAL '7 days'
           ) AS opencode,
           COUNT(*) FILTER (
             WHERE type = 'repo_autofix'
               AND created_at >= NOW() - INTERVAL '7 days'
           ) AS autofix,
           COUNT(*) FILTER (
             WHERE type = 'repo_index_autopatch'
               AND created_at >= NOW() - INTERVAL '7 days'
           ) AS autopatch
         FROM tasks
        WHERE LOWER(COALESCE(payload->>'repo','')) = ANY($1::text[])`,
        [[repoName.toLowerCase(), repoKey, repoName]]
      );
      const coverageSignals =
        (Number(coverage.rows[0]?.opencode || 0) > 0 ? 1 : 0) +
        (Number(coverage.rows[0]?.autofix || 0) > 0 ? 1 : 0) +
        (Number(coverage.rows[0]?.autopatch || 0) > 0 ? 1 : 0);

      const score = scoreRepo(indexAgeHours, repomapAgeHours, coverageSignals);
      const reasons = [];
      if (indexAgeHours == null) reasons.push("index_missing");
      else if (indexAgeHours > 24) reasons.push("index_stale");
      if (repomapAgeHours == null) reasons.push("repomap_missing");
      else if (repomapAgeHours > 24) reasons.push("repomap_stale");
      if (coverageSignals === 0) reasons.push("agent_coverage_low");

      const prevScore = previousScore(trend, repoKey);
      if (prevScore != null && prevScore - score.total >= alertDrop) {
        regressions.push({
          repo: repoKey,
          previous_score: prevScore,
          current_score: score.total,
          drop: Number((prevScore - score.total).toFixed(2)),
        });
      }
      updateTrend(trend, repoKey, score.total, generatedAt);

      let remediation = null;
      if (score.total < minScore) {
        const staleIndex = indexAgeHours == null || indexAgeHours > 24;
        const staleRepomap = repomapAgeHours == null || repomapAgeHours > 24;
        if (staleIndex || staleRepomap) {
          indexTargets.push({
            repo: repoKey,
            local_path: localPath || null,
            index_age_hours: indexAgeHours,
            repomap_age_hours: repomapAgeHours,
            reasons,
          });
          remediation = await createTaskIfNeeded(
            "repo_index_autopatch",
            {
              repo: repoKey,
              repo_path: localPath || undefined,
              source: "repo_readiness_pulse",
              reasons,
              queue_opencode_after: true,
            },
            7,
            dryRun,
            { failOpenOnLockTimeout: validationMode }
          );
        } else {
          remediation = await createTaskIfNeeded(
            "opencode_controller",
            {
              repo: repoName,
              source: "repo_readiness_pulse",
              objective: `Raise repo readiness above ${minScore} and close drift gaps.`,
              max_iterations: 2,
              quality_target: 90,
              auto_iterate: true,
            },
            6,
            dryRun,
            { failOpenOnLockTimeout: validationMode }
          );
        }
        remediations.push({ repo: repoKey, remediation });
      }

      rows.push({
        repo: repoKey,
        local_path: localPath || null,
        index: { age_hours: indexAgeHours, finished_at: indexFinished },
        repomap: { path: repomapPath, age_hours: repomapAgeHours },
        coverage: {
          opencode_runs_7d: Number(coverage.rows[0]?.opencode || 0),
          autofix_runs_7d: Number(coverage.rows[0]?.autofix || 0),
          autopatch_runs_7d: Number(coverage.rows[0]?.autopatch || 0),
        },
        score,
        reasons,
      });
    } catch (err) {
      const reason = String(err?.message || "repo_readiness_repo_failed");
      if (!validationMode || !/lock timeout|statement timeout|canceling statement due to lock timeout/i.test(reason)) {
        throw err;
      }
      rows.push({
        repo: repoKey,
        local_path: localPath || null,
        index: { age_hours: null, finished_at: null },
        repomap: { path: repomapPathForRepo(repoName), age_hours: null },
        coverage: { opencode_runs_7d: 0, autofix_runs_7d: 0, autopatch_runs_7d: 0 },
        score: { total: 0, index: 0, repomap: 0, coverage: 0 },
        reasons: ["validation_timeout_skipped"],
        skipped_due_to_lock_contention: true,
      });
    }
  }

  trend.updated_at = generatedAt;
  writeJsonSafe(TREND_PATH, trend);

  const report = {
    ok: true,
    generated_at: generatedAt,
    dry_run: dryRun,
    min_score: minScore,
    limit: limit || null,
    skip_lock_ddl: skipLockDdl,
    ddl,
    managed_repos_source_total: reposRaw.length,
    managed_repos_collapsed_total: reposAll.length,
    repos_total: rows.length,
    summary: {
      below_threshold: rows.filter((r) => Number(r.score.total || 0) < minScore).length,
      remediations_queued: remediations.filter((r) => r.remediation?.created).length,
      remediations_duplicates: remediations.filter((r) => r.remediation && !r.remediation.created).length,
      regressions_detected: regressions.length,
      duplicate_repo_records_collapsed: duplicateRepos.length,
    },
    duplicate_repo_records: duplicateRepos,
    repos: rows,
    index_targets: indexTargets,
    remediations,
    regressions,
  };

  if (notifyRegressions && regressions.length > 0) {
    const top = regressions
      .slice()
      .sort((a, b) => Number(b.drop || 0) - Number(a.drop || 0))
      .slice(0, 8);
    const lines = [
      `Repo readiness regressions detected (${generatedAt})`,
      ...top.map((r) => `- ${r.repo}: ${r.previous_score} -> ${r.current_score} (drop ${r.drop})`),
    ];
    report.monitoring_notify = await notifyMonitoring(lines.join("\n"));
  }

  const paths = writeReport(report);
  console.log(JSON.stringify({ ...report, report: paths }, null, 2));
}

main()
  .then(async () => {
    await pg.query(`RESET statement_timeout`).catch(() => {});
    await pg.end();
  })
  .catch(async (err) => {
    const msg = String(err?.message || "repo_readiness_pulse_failed");
    const validationMode = has("--dry-run") || has("--skip-lock-ddl") || (Number(arg("--limit", "0")) || 0) > 0;
    if (validationMode && /lock timeout|statement timeout|query read timeout|canceling statement due to lock timeout/i.test(msg)) {
      console.log(JSON.stringify({
        ok: false,
        degraded: true,
        reason: msg,
        validation_mode: true,
      }, null, 2));
      await pg.query(`RESET statement_timeout`).catch(() => {});
      try { await pg.end(); } catch {}
      process.exit(0);
      return;
    }
    console.error(`repo-readiness-pulse failed: ${msg}`);
    await pg.query(`RESET statement_timeout`).catch(() => {});
    try { await pg.end(); } catch {}
    process.exit(1);
  });

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const READINESS_LATEST = path.join(REPORT_DIR, "repo-readiness-pulse-latest.json");
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeRepo(repo) {
  const raw = String(repo || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("local/")) return raw;
  return `local/${raw.replace(/^local\//i, "")}`;
}

function parseReposCsv(value) {
  return String(value || "")
    .split(",")
    .map((x) => normalizeRepo(x))
    .filter(Boolean);
}

function runStep(name, command) {
  const res = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  return {
    name,
    command,
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    stdout_tail: String(res.stdout || "").slice(-1200),
    stderr_tail: String(res.stderr || "").slice(-1200),
  };
}

function repoArgFromLocalRepo(repo) {
  return String(repo || "")
    .replace(/^local\//i, "")
    .trim();
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

async function createTaskIfNeeded(type, payload, priority, dryRun) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload);

  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  if (dryRun) {
    return {
      created: true,
      dry_run: true,
      type,
      payload,
      idempotencyKey,
    };
  }

  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", type, idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1, $2, $3::jsonb, 'CREATED', $4, $5, $6, $7)`,
    [id, type, JSON.stringify(payload), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});

  return { created: true, id, type, idempotencyKey };
}

function pickRepos({ explicitRepos, limit, minScore }) {
  if (explicitRepos.length > 0) {
    return explicitRepos.slice(0, limit).map((repo) => ({
      repo,
      total_score: null,
      reasons: ["explicit"],
    }));
  }

  const readiness = readJsonSafe(READINESS_LATEST);
  const repos = Array.isArray(readiness?.repos) ? readiness.repos : [];

  const normalized = repos
    .map((r) => {
      const repo = normalizeRepo(r.repo);
      const total = Number(r?.score?.total || 0);
      return {
        repo,
        total_score: Number.isFinite(total) ? total : 0,
        reasons: Array.isArray(r.reasons) ? r.reasons : [],
      };
    })
    .filter((r) => r.repo);

  const belowThreshold = normalized
    .filter((r) => r.total_score < minScore)
    .sort((a, b) => a.total_score - b.total_score)
    .slice(0, limit);

  if (belowThreshold.length > 0) return belowThreshold;

  return normalized
    .sort((a, b) => a.total_score - b.total_score)
    .slice(0, limit);
}

function writeReport(result) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportPath = path.join(REPORT_DIR, `${stamp}-masterpiece-builder-agent.json`);
  const latestPath = path.join(REPORT_DIR, "masterpiece-builder-agent-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(result, null, 2));
  return { reportPath, latestPath };
}

async function main() {
  const dryRun = has("--dry-run");
  const source = String(arg("--source", "masterpiece_builder_agent")).trim();
  const limit = Math.max(1, Number(arg("--limit", "3")) || 3);
  const minScore = Math.max(1, Number(arg("--min-score", "82")) || 82);
  const maxIterations = Math.max(1, Number(arg("--max-iterations", "2")) || 2);
  const qualityTarget = Math.max(1, Number(arg("--quality-target", "90")) || 90);
  const explicitRepos = parseReposCsv(arg("--repos", ""));
  const autoResearch = !has("--no-auto-research");
  const researchOnly = has("--research-only");
  const strictResearchGate = !has("--allow-build-without-research");
  const preflightMaxAgeHours = Math.max(1, Number(arg("--preflight-max-age-hours", "48")) || 48);
  const scoutLimit = Math.max(limit, Number(arg("--scout-limit", String(Math.max(8, limit * 3)))) || Math.max(8, limit * 3));
  const scoutUiProbeLimit = Math.max(10, Number(arg("--scout-ui-probe-limit", "45")) || 45);

  const steps = [runStep("mcp_health", "npm run -s mcp:health")];

  if (autoResearch) {
    steps.push(
      runStep(
        "oss_dashboard_chat_scout",
        `npm run -s dashboard:repo:scout -- --limit ${scoutLimit} --min-stars 500 --per-query 25 --ui-probe-limit ${scoutUiProbeLimit}`
      )
    );
    steps.push(runStep("index_sync", `npm run -s index:sync:agent${dryRun ? " -- --dry-run" : ""}`));
    steps.push(runStep("repo_readiness", `npm run -s repo:readiness:pulse -- --min-score ${minScore}`));
  }

  const repos = pickRepos({ explicitRepos, limit, minScore });
  const queueResults = [];
  const benchmarkSteps = [];

  if (autoResearch && repos.length > 0) {
    const preflightRepos = repos.map((r) => repoArgFromLocalRepo(r.repo)).filter(Boolean).join(",");
    if (preflightRepos) {
      steps.push(
        runStep(
          "symbol_index_preflight",
          `node ./scripts/symbol-index-preflight.js --repos ${preflightRepos} --max-age-hours ${preflightMaxAgeHours}`
        )
      );
    }

    for (const item of repos) {
      const repo = normalizeRepo(item.repo);
      const featureFlag = String(arg("--benchmark-feature", "")).trim();
      const featureArg = featureFlag ? ` --feature ${featureFlag}` : "";
      const bench = runStep(
        `benchmark_compare_${repo.replace(/[^a-zA-Z0-9]/g, "_")}`,
        `npm run -s benchmark:score -- --repo ${repo}${featureArg} --source masterpiece_builder_prebuild --dry-run`
      );
      benchmarkSteps.push(bench);
      steps.push(bench);
    }
  }

  const researchStepFailures = steps.filter((s) => !s.ok && s.name !== "mcp_health");
  const researchGatePassed = !autoResearch || researchStepFailures.length === 0;
  const queueBlocked = researchOnly || (strictResearchGate && !researchGatePassed);

  if (!dryRun && !queueBlocked) {
    await ensureRoutingColumns();
  }

  if (!queueBlocked) {
    for (const item of repos) {
      const repo = item.repo;
      const reasons = item.reasons.length ? item.reasons : ["readiness"].slice(0, 3);

      const indexPayload = {
        repo,
        source,
        reasons,
        queue_opencode_after: false,
        objective: `Refresh MCP-aware index + repo map for ${repo} before implementation.`,
        force: false,
      };

      const opencodePayload = {
        repo,
        source,
        objective: `Build a fully functional, production-ready feature increment for ${repo}. First do filesystem MCP + rg/local symbol-map indexing (no jcodemunch), run repo_mapper when available, then implement with tests and evidence-ready output.`,
        max_iterations: maxIterations,
        quality_target: qualityTarget,
        auto_iterate: true,
        force_implement: true,
      };

      const indexQueue = await createTaskIfNeeded("repo_index_autopatch", indexPayload, 9, dryRun);
      const opencodeQueue = await createTaskIfNeeded("opencode_controller", opencodePayload, 9, dryRun);

      queueResults.push({
        repo,
        total_score: item.total_score,
        index: indexQueue,
        opencode: opencodeQueue,
      });
    }
  }

  const result = {
    ok: steps.every((s) => s.ok) && (queueBlocked ? true : true),
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    source,
    settings: {
      limit,
      min_score: minScore,
      max_iterations: maxIterations,
      quality_target: qualityTarget,
      explicit_repos: explicitRepos,
      auto_research: autoResearch,
      research_only: researchOnly,
      strict_research_gate: strictResearchGate,
      preflight_max_age_hours: preflightMaxAgeHours,
      scout_limit: scoutLimit,
      scout_ui_probe_limit: scoutUiProbeLimit,
    },
    research: {
      gate_passed: researchGatePassed,
      failures: researchStepFailures.map((s) => ({ name: s.name, code: s.code })),
      benchmark_steps: benchmarkSteps.map((s) => ({ name: s.name, ok: s.ok, code: s.code })),
    },
    queue_blocked: queueBlocked,
    queue_block_reason: researchOnly
      ? "research_only_mode"
      : (!researchGatePassed && strictResearchGate ? "strict_research_gate_failed" : null),
    steps,
    repos_selected: repos,
    queue_results: queueResults,
    queued_created: queueResults.reduce(
      (acc, item) => acc + (item.index?.created ? 1 : 0) + (item.opencode?.created ? 1 : 0),
      0
    ),
    queued_skipped: queueResults.reduce(
      (acc, item) => acc + (item.index?.created ? 0 : 1) + (item.opencode?.created ? 0 : 1),
      0
    ),
  };

  const report = writeReport(result);
  console.log(JSON.stringify({ ...result, report }, null, 2));

  if (!result.ok) process.exit(1);
}

main()
  .then(async () => {
    await pg.end();
  })
  .catch(async (err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    try {
      await pg.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });

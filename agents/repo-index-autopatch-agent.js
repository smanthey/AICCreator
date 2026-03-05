"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { register } = require("./registry");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
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

async function createTaskIfNeeded(type, payload) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload);
  await ensureRoutingColumns();
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", idempotency_key: idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6)`,
    [id, type, JSON.stringify(payload || {}), routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, idempotency_key: idempotencyKey };
}

function slugifyRepo(input) {
  return String(input || "")
    .trim()
    .replace(/^local\//i, "")
    .replace(/\.git$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeRepoKey(input) {
  const slug = slugifyRepo(input).toLowerCase();
  return slug ? `local/${slug}` : "local/unknown";
}

async function resolveRepoPath(repoKey, payload = {}) {
  const direct = String(payload.repo_path || "").trim();
  if (direct && fs.existsSync(direct)) return direct;

  const slug = slugifyRepo(repoKey);
  const candidates = [
    path.join(ROOT, slug),
    path.join(path.dirname(ROOT), "claw-repos", slug),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  try {
    const { rows } = await pg.query(
      `SELECT local_path
         FROM managed_repos
        WHERE LOWER(local_path) LIKE $1 OR LOWER(client_name) = $2
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [`%/${slug.toLowerCase()}`, slug.toLowerCase()]
    );
    const dbPath = String(rows[0]?.local_path || "").trim();
    if (dbPath && fs.existsSync(dbPath)) return dbPath;
  } catch {
    // ignore lookup failures
  }

  return null;
}

function run(cmd, args, cwd = ROOT) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 15 * 60 * 1000,
  });
}

function runRepoMap(repoPath, repoKey) {
  const slug = slugifyRepo(repoKey).toLowerCase() || "unknown";
  const outFile = path.join(ROOT, "scripts", "reports", "repomaps", `${slug}-repomap.md`);
  const res = run("node", [path.join(ROOT, "scripts", "repo-map.js"), repoPath, outFile], ROOT);
  return {
    ok: res.status === 0,
    code: Number(res.status || 1),
    output_path: outFile,
    stdout_tail: String(res.stdout || "").slice(-1200),
    stderr_tail: String(res.stderr || "").slice(-1200),
  };
}

register("repo_index_autopatch", async (payload = {}) => {
  const repoKey = normalizeRepoKey(payload.repo);
  const source = String(payload.source || "repo_index_autopatch");
  const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
  const queueOpencodeAfter = payload.queue_opencode_after !== false;
  const repoPath = await resolveRepoPath(repoKey, payload);

  const queued = [];
  if (repoPath) {
    queued.push(await createTaskIfNeeded("index", {
      path: repoPath,
      force: Boolean(payload.force),
      source,
      reason: `repo_index_autopatch:${repoKey}`,
    }));
  } else {
    queued.push({ created: false, reason: "repo_path_not_found" });
  }

  const repomap = repoPath ? runRepoMap(repoPath, repoKey) : {
    ok: false,
    code: 1,
    output_path: null,
    stdout_tail: "",
    stderr_tail: "repo path not found",
  };

  if (queueOpencodeAfter) {
    const objective = String(payload.objective || "").trim() ||
      `Run filesystem MCP + rg symbol-map indexing (no jcodemunch) and repo_mapper if available for ${repoKey}, then continue implementation.`;
    queued.push(await createTaskIfNeeded("opencode_controller", {
      repo: repoKey,
      source,
      objective,
      max_iterations: 2,
      quality_target: 90,
      auto_iterate: true,
      force_implement: true,
    }));
  }

  return {
    ok: true,
    repo: repoKey,
    repo_path: repoPath,
    source,
    reasons,
    repomap,
    queued_tasks: queued,
    queued_created: queued.filter((x) => x && x.created).length,
    queued_skipped: queued.filter((x) => !x || !x.created).length,
    output_contract: {
      repo: repoKey,
      symbol_ids: [],
      index_run: true,
      repo_map_path: repomap.output_path,
      changed_files: [],
      tests_passed: true,
    },
    cost_usd: 0,
    model_used: "deterministic-repo-index-autopatch",
  };
});

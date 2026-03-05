#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const args = process.argv.slice(2);

function has(flag) {
  return args.includes(flag);
}

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function usageAndExit() {
  console.error("Usage: npm run dev:pipeline:queue -- --task \"<work item>\" [--task-slug slug] [--repo-path /abs/path] [--base-branch main] [--branch-name codex/... ] [--test-command \"npm run -s qa:fast\"] [--security-command \"npm run -s security:sweep -- --dep-fail-on high\"] [--live]");
  process.exit(1);
}

function parsePayload() {
  const task = String(arg("--task", "")).trim();
  if (!task) usageAndExit();

  const payload = {
    task,
    dry_run: !has("--live"),
  };

  const taskSlug = arg("--task-slug");
  const repoPath = arg("--repo-path");
  const baseBranch = arg("--base-branch");
  const branchName = arg("--branch-name");
  const testCommand = arg("--test-command");
  const securityCommand = arg("--security-command");

  if (taskSlug) payload.task_slug = taskSlug;
  if (repoPath) payload.repo_path = repoPath;
  if (baseBranch) payload.base_branch = baseBranch;
  if (branchName) payload.branch_name = branchName;
  if (testCommand) payload.test_command = testCommand;
  if (securityCommand) payload.security_command = securityCommand;
  return payload;
}

async function main() {
  const payload = parsePayload();
  validatePayload("dev_pipeline_run", payload);

  const routing = resolveRouting("dev_pipeline_run");
  const idempotencyKey = buildTaskIdempotencyKey("dev_pipeline_run", payload);
  const taskId = uuidv4();

  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, title, worker_queue, required_tags, idempotency_key)
     VALUES ($1, 'dev_pipeline_run', $2::jsonb, 'CREATED', 4, 'dev pipeline run', $3, $4, $5)`,
    [taskId, JSON.stringify(payload), routing.queue, routing.required_tags, idempotencyKey]
  );

  await pg.query(`SELECT pg_notify('task_created', 'single_task')`).catch(() => {});

  console.log("\n✅ dev_pipeline_run task queued");
  console.log(`task_id: ${taskId}`);
  console.log(`queue: ${routing.queue}`);
  console.log(`required_tags: [${(routing.required_tags || []).join(", ")}]`);
  console.log(`idempotency_key: ${idempotencyKey}`);
  console.log(`payload: ${JSON.stringify(payload)}`);
}

main()
  .then(async () => {
    await pg.end();
  })
  .catch(async (err) => {
    console.error(`[dev-pipeline] fatal: ${err.message}`);
    try { await pg.end(); } catch {}
    process.exit(1);
  });


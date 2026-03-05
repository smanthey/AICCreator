#!/usr/bin/env node
"use strict";

/**
 * PayClaw Distributed Build — dispatch chunks to all machines
 *
 * Queues multiple opencode_controller tasks for the PayClaw repo. Each chunk has
 * a distinct objective; workers on NAS, i7, and AI satellite pick them up from
 * the shared queue. Faster parallel progress.
 *
 * Usage:
 *   npm run payclaw:dispatch:chunks
 *   npm run payclaw:dispatch:chunks -- --dry-run
 */

require("dotenv").config();

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { v4: uuidv4 } = require("uuid");

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const REPO = "payclaw";

const CHUNKS = [
  {
    source: "payclaw_chunk_sms",
    objective:
      "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. Reuse existing code from other repos (see docs/SOURCES.md), then port text-to-pay-sms-service.js from autopay_ui to PayClaw. Adapt for single-tenant; remove multi-tenant logic.",
  },
  {
    source: "payclaw_chunk_stripe",
    objective:
      "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. Reuse existing Stripe code from source repos (docs/SOURCES.md), then port webhook + checkout flow to PayClaw with signature verification and idempotency.",
  },
  {
    source: "payclaw_chunk_api",
    objective:
      "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. Reuse existing API wiring from source repos (docs/SOURCES.md), then port Express routes/app wiring (text-to-pay-endpoints.js, text-to-pay-app.js) to PayClaw.",
  },
  {
    source: "payclaw_chunk_dashboard",
    objective:
      "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. Reuse existing dashboard code from source repos (docs/SOURCES.md), then port CSV upload + invoice list + status dashboard to PayClaw Mac desktop.",
  },
  {
    source: "payclaw_chunk_mac_shell",
    objective:
      "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. Reuse existing Mac shell/build patterns from source repos (docs/SOURCES.md), then complete SwiftUI shell for PayClaw and embed Node backend as LaunchAgent per docs/payclaw/SPEC.md §5.",
  },
  {
    source: "payclaw_chunk_compliance",
    objective:
      "Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper to map entrypoints/dependencies when available. Reuse compliance implementations from source repos (docs/SOURCES.md), then wire risk-categories.json, message-templates.txt, and attestations.txt into PayClaw.",
  },
];

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks
     WHERE idempotency_key = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTask(type, payload, dryRun) {
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", idempotencyKey };
  }

  if (dryRun) {
    return { created: true, dry_run: true, idempotencyKey, payload };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  const priority = 9; // P1 priority lane: finish PayClaw immediately after CookiesPass
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1, $2, $3::jsonb, 'CREATED', $4, $5, $6, $7)`,
    [id, type, JSON.stringify(payload), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});

  return { created: true, id, type, idempotencyKey };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (!isKnownTaskType("opencode_controller")) {
    throw new Error("opencode_controller task type not found in routing");
  }

  const results = [];
  for (const chunk of CHUNKS) {
    const payload = {
      repo: REPO,
      objective: chunk.objective,
      source: chunk.source,
      max_iterations: 4,
      quality_target: 85,
      auto_iterate: true,
    };
    const res = await createTask("opencode_controller", payload, dryRun);
    results.push({ source: chunk.source, ...res });
  }

  const created = results.filter((r) => r.created && !r.dry_run).length;
  const skipped = results.filter((r) => !r.created).length;

  console.log(JSON.stringify(
    {
      ok: true,
      dry_run: dryRun,
      repo: REPO,
      chunks_total: CHUNKS.length,
      chunks_queued: created,
      chunks_skipped: skipped,
      results,
    },
    null,
    2
  ));
}

main()
  .catch((err) => {
    console.error("[payclaw-dispatch-chunks]", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

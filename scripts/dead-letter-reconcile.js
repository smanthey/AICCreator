#!/usr/bin/env node
"use strict";
/**
 * Dead-letter reconcile: requeue recoverable tasks, cancel/quarantine the rest.
 * Usage:
 *   node scripts/dead-letter-reconcile.js [--requeue]           — requeue recoverable, cancel others
 *   node scripts/dead-letter-reconcile.js --requeue-id <uuid>    — force requeue one task (e.g. reaper-quarantined)
 */

require("dotenv").config();
const pg = require("../infra/postgres");
const args = process.argv.slice(2);
const REQUEUE =
  args.includes("--requeue") ||
  ["1", "true", "yes", "on"].includes(String(process.env.DLQ_LIVE_MODE || "").toLowerCase());

const requeueIdIdx = args.indexOf("--requeue-id");
const REQUEUE_ID = requeueIdIdx >= 0 && args[requeueIdIdx + 1] ? args[requeueIdIdx + 1].trim() : null;

function isLikelyUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

async function main() {
  // Manual requeue of a single dead-letter task by ID (e.g. reaper-quarantined copy_lab_run).
  if (REQUEUE_ID && isLikelyUuid(REQUEUE_ID)) {
    const res = await pg.query(
      `UPDATE tasks
       SET status = 'CREATED',
           retry_count = 0,
           last_error = NULL,
           next_retry_at = NULL,
           started_at = NULL,
           completed_at = NULL,
           dead_lettered_at = NULL,
           dead_letter_reason = NULL,
           updated_at = NOW()
       WHERE id = $1::uuid AND status = 'DEAD_LETTER'
       RETURNING id, type`,
      [REQUEUE_ID]
    );
    if (res.rowCount > 0) {
      await pg.query(
        `UPDATE task_quarantine SET active = FALSE, updated_at = NOW() WHERE task_id = $1::uuid`,
        [REQUEUE_ID]
      ).catch(() => {});
      console.log(`requeued 1 task: ${REQUEUE_ID} (${res.rows[0].type})`);
    } else {
      console.log(`no dead-letter task found for id ${REQUEUE_ID} (or already requeued)`);
    }
    return;
  }
  if (REQUEUE_ID) {
    console.error("Invalid --requeue-id: expected a UUID.");
    process.exit(1);
  }

  const { rows } = await pg.query(
    `SELECT id, type, payload, last_error
     FROM tasks
     WHERE status = 'DEAD_LETTER'
     ORDER BY created_at DESC`
  );

  const recoverable = [];
  const cancelOnly = [];

  for (const r of rows) {
    const err = String(r.last_error || "");
    const payload = r.payload || {};

    const missingHandler =
      /Unknown task type/i.test(err) ||
      /No handler registered/i.test(err) ||
      /handler is not a function/i.test(err);

    const badPlanUuid =
      r.type === "report" &&
      /invalid input syntax for type uuid/i.test(err) &&
      payload &&
      Object.prototype.hasOwnProperty.call(payload, "plan_id") &&
      !isLikelyUuid(payload.plan_id);
    const blockedUnsafePath =
      /POLICY_BLOCKED:\s*payload\.path is outside allowed prefixes/i.test(err);
    const staleDispatchedLoop =
      /stale dispatched requeue loop cleanup/i.test(err);
    const repoAutofixExhausted =
      r.type === "repo_autofix" &&
      /repo_autofix verification failed/i.test(err);
    const knownExternalProvisionFailure =
      r.type === "brand_provision" &&
      (/maileroo domain create failed/i.test(err) || /unable to find the requested endpoint/i.test(err));
    const historicalSecuritySweepMismatch =
      r.type === "security_sweep" &&
      /schema_audit/i.test(err);
    const recurringSecuritySweepExecutionError =
      r.type === "security_sweep" &&
      /security-sweep\.js failed/i.test(err);
    const genericInvalidSchema =
      /INVALID_SCHEMA:/i.test(err) ||
      /must have required property/i.test(err) ||
      /payload error/i.test(err);
    const missingRepoPath =
      r.type === "repo_autofix" &&
      /repo missing:/i.test(err);
    const invalidUuidPayload =
      /invalid input syntax for type uuid/i.test(err);
    const missingRepoPackageJson =
      r.type === "repo_autofix" &&
      /missing\/invalid package\.json/i.test(err);
    const staleMigrationGuard =
      /Migration 072 must be applied first/i.test(err);

    if (
      badPlanUuid ||
      blockedUnsafePath ||
      staleDispatchedLoop ||
      repoAutofixExhausted ||
      missingRepoPath ||
      missingRepoPackageJson ||
      invalidUuidPayload ||
      staleMigrationGuard ||
      knownExternalProvisionFailure ||
      historicalSecuritySweepMismatch ||
      recurringSecuritySweepExecutionError ||
      genericInvalidSchema
    ) {
      cancelOnly.push(r.id);
      continue;
    }

    if (missingHandler) {
      recoverable.push(r.id);
      continue;
    }
  }

  let requeued = 0;
  let cancelled = 0;

  if (recoverable.length && REQUEUE) {
    const res = await pg.query(
      `UPDATE tasks
       SET status = 'CREATED',
           retry_count = 0,
           last_error = NULL,
           next_retry_at = NULL,
           started_at = NULL,
           completed_at = NULL,
           dead_lettered_at = NULL,
           dead_letter_reason = NULL,
           updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING id`,
      [recoverable]
    );
    requeued = res.rowCount || 0;

    await pg.query(
      `UPDATE task_quarantine
       SET active = FALSE,
           updated_at = NOW()
       WHERE task_id = ANY($1::uuid[])`,
      [recoverable]
    ).catch(() => {});
  } else if (recoverable.length) {
    const res = await pg.query(
      `UPDATE tasks
       SET status = 'CANCELLED',
           last_error = COALESCE(last_error, '') || ' [auto_cancelled:legacy_handler_gap]',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING id`,
      [recoverable]
    );
    cancelled += res.rowCount || 0;

    await pg.query(
      `INSERT INTO task_quarantine (task_id, reason, source, active, metadata)
       SELECT t.id, 'legacy_handler_gap', 'dead-letter-reconcile', TRUE, '{}'::jsonb
       FROM tasks t
       WHERE t.id = ANY($1::uuid[])
       ON CONFLICT (task_id)
       DO UPDATE SET reason='legacy_handler_gap', source='dead-letter-reconcile', active=TRUE, updated_at=NOW()`,
      [recoverable]
    ).catch(() => {});
  }

  if (cancelOnly.length) {
    const res = await pg.query(
      `UPDATE tasks
       SET status = 'CANCELLED',
           last_error = COALESCE(last_error, '') || ' [auto_cancelled:invalid_payload]',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING id`,
      [cancelOnly]
    );
    cancelled += res.rowCount || 0;

    await pg.query(
      `INSERT INTO task_quarantine (task_id, reason, source, active, metadata)
       SELECT t.id,
              CASE
                WHEN t.type='repo_autofix' THEN 'repo_autofix_exhausted'
                WHEN t.type='brand_provision' THEN 'external_provider_failure'
                WHEN t.type='security_sweep' THEN 'historical_schema_mismatch'
                WHEN COALESCE(t.last_error,'') ILIKE '%INVALID_SCHEMA:%' THEN 'invalid_schema_payload'
                WHEN COALESCE(t.last_error,'') ILIKE '%must have required property%' THEN 'invalid_schema_payload'
                WHEN COALESCE(t.last_error,'') ILIKE '%invalid input syntax for type uuid%' THEN 'invalid_uuid_payload'
                WHEN COALESCE(t.last_error,'') ILIKE '%Migration 072 must be applied first%' THEN 'stale_migration_guard'
                WHEN COALESCE(t.last_error,'') ILIKE '%missing/invalid package.json%' THEN 'repo_invalid_package'
                WHEN COALESCE(t.last_error,'') ILIKE '%stale dispatched requeue loop cleanup%' THEN 'stale_dispatched_cleanup'
                ELSE 'invalid_payload'
              END,
              'dead-letter-reconcile',
              TRUE,
              '{}'::jsonb
       FROM tasks t
       WHERE t.id = ANY($1::uuid[])
       ON CONFLICT (task_id)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         source = 'dead-letter-reconcile',
         active = TRUE,
         updated_at = NOW()`,
      [cancelOnly]
    ).catch(() => {});
  }

  const remaining = await pg.query(
    `SELECT count(*)::int AS n
     FROM tasks
     WHERE status = 'DEAD_LETTER'`
  );

  console.log("\n=== Dead Letter Reconcile ===\n");
  console.log(`mode:                 ${REQUEUE ? "requeue" : "cancel_legacy"}`);
  console.log(`dead_letters_scanned: ${rows.length}`);
  console.log(`requeued:             ${requeued}`);
  console.log(`cancelled:            ${cancelled}`);
  console.log(`remaining_deadletter: ${remaining.rows[0].n}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch (_) {}
    process.exit(1);
  });

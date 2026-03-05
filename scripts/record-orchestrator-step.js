#!/usr/bin/env node
/**
 * Record an orchestrator step run (for gap analysis and backlog-orchestrator).
 * Use after manually running a step (e.g. security:sweep) so security_pulse_recent passes.
 *
 * Usage:
 *   node scripts/record-orchestrator-step.js <step_name> [COMPLETED|FAILED|SKIPPED]
 *   node scripts/record-orchestrator-step.js security_sweep COMPLETED
 */
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

const stepName = process.argv[2] || "security_sweep";
const status = (process.argv[3] || "COMPLETED").toUpperCase();
const valid = ["COMPLETED", "FAILED", "SKIPPED"];
if (!valid.includes(status)) {
  console.error("Usage: node scripts/record-orchestrator-step.js <step_name> [COMPLETED|FAILED|SKIPPED]");
  process.exit(1);
}

async function main() {
  await pg.query(
    `INSERT INTO orchestrator_step_runs
       (step_name, runner, status, started_at, completed_at, duration_ms, reason, result_json)
     VALUES ($1, 'record_orchestrator_step', $2, NOW() - INTERVAL '1 minute', NOW(), 60000, 'manual_record', '{}'::jsonb)`,
    [stepName, status]
  );
  console.log(`Recorded: step_name=${stepName} status=${status}`);
  await pg.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

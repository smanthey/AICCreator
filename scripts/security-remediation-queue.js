#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const REPORT_DIR = path.join(__dirname, "reports");
const LIMIT = Math.max(1, Number(process.argv.includes("--limit") ? process.argv[process.argv.indexOf("--limit") + 1] : "10") || 10);

function latestSecurityReport() {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const files = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith("-security-sweep.json"))
    .sort();
  if (!files.length) return null;
  return path.join(REPORT_DIR, files[files.length - 1]);
}

async function taskExists(key) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks WHERE idempotency_key=$1 AND status IN ('CREATED','DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL','DEAD_LETTER') LIMIT 1`,
    [key]
  );
  return rows.length > 0;
}

async function queueTask(type, payload) {
  const key = buildTaskIdempotencyKey(type, payload);
  if (await taskExists(key)) return { created: false, reason: "duplicate_active" };
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id,type,payload,status,worker_queue,required_tags,idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6)`,
    [uuidv4(), type, JSON.stringify(payload), routing.queue, routing.required_tags || [], key]
  );
  return { created: true };
}

async function main() {
  const rp = latestSecurityReport();
  if (!rp) {
    console.log("No security report found.");
    return;
  }
  const report = JSON.parse(fs.readFileSync(rp, "utf8"));
  const failing = (report.checks || []).filter((c) => c.ok === false).slice(0, LIMIT);

  let queued = 0;
  for (const f of failing) {
    const payload = {
      repo: "claw-architect",
      source: "security_remediation_queue",
      reason: `security_${f.check || "unknown"}`,
      checks_failed: [String(f.check || "security")],
      pulse_hour: new Date().toISOString().slice(0, 13),
    };
    const q = await queueTask("repo_autofix", payload);
    if (q.created) queued += 1;
  }

  console.log("\n=== Security Remediation Queue ===\n");
  console.log(`report: ${rp}`);
  console.log(`failing_checks: ${failing.length}`);
  console.log(`queued: ${queued}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

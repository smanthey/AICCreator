#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { buildSymbolContextPack } = require("../control/symbol-context");
const { enqueueOnce } = require("../core/queue");

const REPORT_PATH = path.join(__dirname, "..", "reports", "pm2-failure-symbol-triage-latest.json");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const MAX_FINDINGS = Math.max(3, Number.parseInt(String(process.env.PM2_TRIAGE_MAX_FINDINGS || "6"), 10) || 6);

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

function runPm2Logs() {
  const r = spawnSync("bash", ["-lc", "pm2 logs --lines 220 --nostream 2>&1"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(r.stdout || r.stderr || "");
}

function detectRepo(line) {
  const l = String(line || "");
  if (/\/claw-repos\/payclaw\//i.test(l) || /payclaw/i.test(l)) return "local/payclaw";
  if (/\/claw-architect\//i.test(l) || /claw-(dispatcher|gateway|worker|architect-api|repomap)/i.test(l)) {
    return "local/claw-architect";
  }
  return null;
}

function errorLines(logText) {
  return String(logText || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((line) => /(error|fatal|exception|failed|crash|traceback|unhandled)/i.test(line))
    .filter((line) => !/last\s+\d+\s+lines:/i.test(line))
    .filter((line) => !/\.pm2\/logs\/.*\.log/i.test(line));
}

function fingerprint(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
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

async function enqueueTask(type, payload) {
  return enqueueOnce({ type, payload, activeStatuses: ACTIVE_TASK_STATUSES });
}

async function main() {
  const logs = runPm2Logs();
  const errors = errorLines(logs).slice(-120);

  const findings = [];
  const seen = new Set();
  for (const line of errors) {
    const repo = detectRepo(line);
    if (!repo) continue;
    const fp = `${repo}:${fingerprint(line)}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    findings.push({ repo, line, fingerprint: fp });
    if (findings.length >= MAX_FINDINGS) break;
  }

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    findings_count: findings.length,
    findings,
    queued: [],
  };

  for (const f of findings) {
    const payload = {
      repo: f.repo,
      source: "pm2_failure_symbol_triage",
      reason: f.line.slice(0, 280),
      checks_failed: [`pm2_error:${f.fingerprint}`],
      pulse_hour: new Date().toISOString().slice(0, 13),
      error_excerpt: f.line.slice(0, 700),
      error_fingerprint: f.fingerprint,
    };

    const context = buildSymbolContextPack({
      taskType: "repo_autofix",
      title: "pm2 failure triage",
      payload,
    });
    if (context) {
      payload.symbol_candidates = (context.dependent_symbols || []).map((s) => s.id).slice(0, 8);
      payload.entrypoints = (context.entrypoints || []).slice(0, 8);
      payload.best_source_hints = context.best_source_hints || [];
    }

    const queued = await enqueueTask("repo_autofix", payload);
    report.queued.push({ ...queued, repo: f.repo, fingerprint: f.fingerprint });
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[pm2-failure-symbol-triage] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

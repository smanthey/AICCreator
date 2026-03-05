#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueOnce } = require("../core/queue");

const PAYCLAW_ROOT = process.env.PAYCLAW_REPO_PATH || "$HOME/claw-repos/payclaw";
const MAIN_DIR = path.join(PAYCLAW_ROOT, "server", "src");
const LITE_DIR = path.join(PAYCLAW_ROOT, "PayClaw-Lite", "server", "src");
const REPORT_PATH = path.join(__dirname, "..", "reports", "payclaw-drift-latest.json");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeContent(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function listTsFiles(baseDir) {
  const out = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && /\.tsx?$/i.test(e.name)) {
        out.push(path.relative(baseDir, full));
      }
    }
  }
  walk(baseDir);
  return out.sort();
}

function diffMirrors() {
  const mainFiles = new Set(listTsFiles(MAIN_DIR));
  const liteFiles = new Set(listTsFiles(LITE_DIR));
  const all = [...new Set([...mainFiles, ...liteFiles])].sort();

  const drift = [];
  for (const rel of all) {
    const mainPath = path.join(MAIN_DIR, rel);
    const litePath = path.join(LITE_DIR, rel);
    const hasMain = fs.existsSync(mainPath);
    const hasLite = fs.existsSync(litePath);
    if (!hasMain || !hasLite) {
      drift.push({
        file: rel,
        kind: "missing_mirror",
        main_exists: hasMain,
        lite_exists: hasLite,
      });
      continue;
    }

    const mainRaw = normalizeContent(fs.readFileSync(mainPath, "utf8"));
    const liteRaw = normalizeContent(fs.readFileSync(litePath, "utf8"));
    const mainHash = hashContent(mainRaw);
    const liteHash = hashContent(liteRaw);
    if (mainHash !== liteHash) {
      drift.push({
        file: rel,
        kind: "content_mismatch",
        main_hash: mainHash,
        lite_hash: liteHash,
      });
    }
  }
  return drift;
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
  if (!fs.existsSync(MAIN_DIR) || !fs.existsSync(LITE_DIR)) {
    throw new Error(`PayClaw mirror paths missing: ${MAIN_DIR} and ${LITE_DIR}`);
  }

  const drift = diffMirrors();
  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    repo: "local/payclaw",
    main_dir: MAIN_DIR,
    lite_dir: LITE_DIR,
    drift_count: drift.length,
    drift,
    queued_task: null,
  };

  if (drift.length > 0) {
    const payload = {
      repo: "local/payclaw",
      source: "payclaw_drift_pulse",
      objective:
        `Resolve mirror drift between server/src and PayClaw-Lite/server/src. ` +
        `Align logic while preserving intentional env/runtime differences. Files: ` +
        drift.map((d) => d.file).slice(0, 25).join(", "),
      drift_files: drift.map((d) => d.file),
      drift_count: drift.length,
      pulse_hour: new Date().toISOString().slice(0, 13),
    };
    const queued = await enqueueTask("opencode_controller", payload);
    report.queued_task = queued;
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[payclaw-drift-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

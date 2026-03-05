#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { STATE_ROOT } = require("../control/agent-memory");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "mission-control-agents.json");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");

function dateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parsePm2Processes() {
  try {
    const raw = execSync("pm2 jlist", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    const byName = new Map();
    for (const x of arr) {
      const name = String(x?.name || "").trim();
      if (!name) continue;
      const status = String(x?.pm2_env?.status || "").trim().toLowerCase() || "unknown";
      byName.set(name, status);
    }
    return byName;
  } catch {
    return new Map();
  }
}

function parseLastLogTs(filePath) {
  try {
    const txt = fs.readFileSync(filePath, "utf8");
    const lines = String(txt).split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = String(lines[i] || "").trim();
      if (!line.startsWith("## ")) continue;
      const iso = line.slice(3).trim();
      const ts = Date.parse(iso);
      if (Number.isFinite(ts)) return ts;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTrailingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.indexOf("{"); i >= 0; i = raw.indexOf("{", i + 1)) {
    const candidate = raw.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue scanning
    }
  }
  return null;
}

function runProgressIntegrityAudit() {
  const enabled = String(process.env.MISSION_CONTROL_RUN_PROGRESS_INTEGRITY_AUDIT || "1") !== "0";
  if (!enabled) return { enabled: false };

  const windowMinutes = Math.max(
    15,
    Number(process.env.MISSION_CONTROL_INTEGRITY_WINDOW_MINUTES || "60") || 60
  );
  const res = spawnSync(
    "node",
    ["scripts/progress-integrity-audit.js", "--recent", "--window-minutes", String(windowMinutes)],
    {
      cwd: ROOT,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      timeout: 180000,
    }
  );
  const parsed = parseTrailingJson(`${res.stdout || ""}\n${res.stderr || ""}`) || {};
  return {
    enabled: true,
    ok: Number(res.status || 0) === 0 && Boolean(parsed.ok),
    code: Number(res.status || 0),
    window_minutes: windowMinutes,
    pretend_work_signals: Number(parsed.pretend_work_signals || 0),
    escalations: Number(parsed.escalations || 0),
    report: parsed.report || null,
    lanes: Array.isArray(parsed.lanes)
      ? parsed.lanes.map((x) => ({
          lane: x.lane,
          movement_ok: Boolean(x.movement_ok),
          checklist_completed: Number(x.checklist_completed || 0),
          checklist_total: Number(x.checklist_total || 0),
        }))
      : [],
    stdout_tail: String(res.stdout || "").slice(-1200),
    stderr_tail: String(res.stderr || "").slice(-1200),
  };
}

function runPreflight() {
  const syntaxTargets = [
    "scripts/mission-control-agent-runner.js",
    "scripts/status-review-agent-runner.js",
    "infra/model-router.js",
  ];

  const syntax = syntaxTargets.map((rel) => {
    const res = spawnSync("node", ["--check", rel], {
      cwd: ROOT,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      timeout: 30000,
    });
    return {
      file: rel,
      ok: Number(res.status || 0) === 0,
      code: Number(res.status || 0),
      stderr_tail: String(res.stderr || "").slice(-400),
    };
  });

  const conflict = spawnSync(
    "bash",
    ["-lc", "rg -n \"^(<<<<<<<|>>>>>>>)\" --glob '!scripts/reports/**' --glob '!reports/**' --glob '!.git/**' ."],
    {
      cwd: ROOT,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      timeout: 30000,
    }
  );
  const markers = String(conflict.stdout || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const ok = syntax.every((x) => x.ok) && markers.length === 0;
  return {
    ok,
    syntax,
    merge_conflict_markers: {
      ok: markers.length === 0,
      count: markers.length,
      examples: markers.slice(0, 12),
    },
  };
}

function main() {
  const staleMin = Math.max(5, Number(process.env.MISSION_CONTROL_STALE_MINUTES || "120") || 120);
  const failOnEscalation = String(process.env.MISSION_CONTROL_HEARTBEAT_FAIL_ON_ESCALATION || "1") !== "0";
  const agents = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const pm2ByName = parsePm2Processes();
  const now = Date.now();
  const today = `${dateKey()}.md`;

  const rows = agents.map((a) => {
    const id = String(a.id || "").toLowerCase();
    const logPath = path.join(STATE_ROOT, "agents", id, "memory", today);
    const ts = parseLastLogTs(logPath);
    const ageMin = ts ? Math.floor((now - ts) / 60000) : null;
    const stale = ageMin == null ? true : ageMin > staleMin;
    const pm2Name = `claw-mission-${id}`;
    const pm2Status = pm2ByName.get(pm2Name) || null;
    const pm2Registered = pm2ByName.has(pm2Name);
    return {
      agent_id: id,
      name: a.name,
      cron: a.cron,
      heartbeat_minutes: a.heartbeat_minutes,
      pm2_process: pm2Name,
      pm2_registered: pm2Registered,
      pm2_status: pm2Status,
      memory_log_exists: fs.existsSync(logPath),
      last_checkin_at: ts ? new Date(ts).toISOString() : null,
      age_minutes: ageMin,
      stale,
      status: (!stale && pm2Registered) ? "OK" : "NEEDS_ATTENTION",
    };
  });

  const summary = {
    generated_at: new Date().toISOString(),
    stale_threshold_minutes: staleMin,
    ok: rows.filter((r) => r.status === "OK").length,
    needs_attention: rows.filter((r) => r.status !== "OK").length,
    preflight: runPreflight(),
    progress_integrity_audit: runProgressIntegrityAudit(),
    agents: rows,
  };
  if (!summary.preflight.ok) {
    summary.needs_attention += 1;
    summary.ok = Math.max(0, summary.ok - 1);
  }
  if (summary.progress_integrity_audit.enabled) {
    summary.ok = Math.max(0, summary.ok - summary.progress_integrity_audit.escalations);
    summary.needs_attention += summary.progress_integrity_audit.escalations;
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(REPORT_DIR, `${stamp}-mission-control-heartbeat.json`);
  const latestPath = path.join(REPORT_DIR, "mission-control-heartbeat-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  console.log("=== Mission Control Heartbeat ===");
  console.log(`ok=${summary.ok} needs_attention=${summary.needs_attention}`);
  console.log(
    `preflight: ok=${summary.preflight.ok} merge_markers=${summary.preflight.merge_conflict_markers.count}`
  );
  if (summary.progress_integrity_audit.enabled) {
    console.log(
      `progress_integrity: signals=${summary.progress_integrity_audit.pretend_work_signals || 0} escalations=${summary.progress_integrity_audit.escalations || 0}`
    );
    if (summary.progress_integrity_audit.report?.latestJson) {
      console.log(`progress_integrity_report=${summary.progress_integrity_audit.report.latestJson}`);
    }
  }
  console.log(`latest=${latestPath}`);

  if (
    failOnEscalation &&
    summary.progress_integrity_audit.enabled &&
    Number(summary.progress_integrity_audit.escalations || 0) > 0
  ) {
    process.exit(2);
  }
}

main();

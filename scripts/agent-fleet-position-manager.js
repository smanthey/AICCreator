#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const pg = require("../infra/postgres");

const execAsync = promisify(exec);
const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

const LOOP_SECONDS = Math.max(15, Number(process.env.FLEET_MANAGER_LOOP_SECONDS || "45"));
const MIN_ONLINE = Math.max(6, Number(process.env.FLEET_MANAGER_MIN_ONLINE || "8"));
const MAX_ONLINE = Math.max(MIN_ONLINE, Number(process.env.FLEET_MANAGER_MAX_ONLINE || "13"));
const ONCE = process.argv.includes("--once");
const AI_BACKLOG_THRESHOLD = Math.max(1, Number(process.env.FLEET_AI_BACKLOG_THRESHOLD || "80"));
const AI_MIN_ON_PRESSURE = Math.max(3, Number(process.env.FLEET_AI_MIN_ON_PRESSURE || "3"));
const AI_AGING_PENDING_THRESHOLD = Math.max(1, Number(process.env.FLEET_AI_AGING_PENDING_THRESHOLD || "60"));
const AI_SPIKE_TARGET = Math.max(4, Number(process.env.FLEET_AI_SPIKE_TARGET || "4"));
const INFRA_BACKLOG_THRESHOLD = Math.max(1, Number(process.env.FLEET_INFRA_BACKLOG_THRESHOLD || "50"));
const INFRA_MIN_ON_PRESSURE = Math.max(2, Number(process.env.FLEET_INFRA_MIN_ON_PRESSURE || "2"));

const CORE_SINGLETONS = [
  "claw-dispatcher",
  "claw-webhook-server",
  "claw-architect-api",
  "claw-ollama",
  "claw-brand-control-plane",
  "claw-lead-autopilot-skynpatch",
  "claw-lead-autopilot-bws",
];

const SCALABLE_WORKERS = {
  "claw-worker": { steady: 1, pressure: 2, degraded: 1 },
  "claw-worker-ai": { steady: 2, pressure: 3, degraded: 1 },
  "claw-worker-nas": { steady: 2, pressure: 3, degraded: 1 },
};

const PROTECTED = new Set([
  ...CORE_SINGLETONS,
  ...Object.keys(SCALABLE_WORKERS),
]);

const DEPRIORITIZE = [
  "claw-backlog-orchestrator",
  "claw-priority-repo-major-update-daily",
  "claw-repo-readiness-pulse",
  "claw-mission-heartbeat",
  "claw-proactive-research-assistant",
  "claw-global-status-pulse",
  "claw-ai-work-pulse",
  "claw-utilization-autofill",
  "claw-status-review-coordinator",
  "claw-status-review-schema",
  "claw-status-review-security",
  "claw-status-review-worker",
  "claw-status-review-uptime",
  "claw-system-4h-checkfix",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(arr) {
  return [...new Set(arr)];
}

function cap(txt, n = 1200) {
  const s = String(txt || "");
  return s.length <= n ? s : `${s.slice(0, n)}...[truncated]`;
}

async function sh(cmd, timeout = 15000) {
  return execAsync(cmd, { cwd: ROOT, timeout, maxBuffer: 6 * 1024 * 1024 });
}

async function getPm2List() {
  const { stdout } = await sh("pm2 jlist", 20000);
  return JSON.parse(stdout || "[]");
}

function countOnlineByName(pm2) {
  const out = new Map();
  for (const p of pm2) {
    const name = String(p.name || "");
    if (!name) continue;
    const n = out.get(name) || 0;
    if (p.pm2_env?.status === "online") out.set(name, n + 1);
    else out.set(name, n);
  }
  return out;
}

async function getHealthAndQueue() {
  const result = {
    healthOk: false,
    postgresOk: false,
    redisOk: false,
    queue: null,
    errors: [],
  };

  try {
    const { stdout } = await sh("curl -m 4 -sS http://127.0.0.1:4051/health", 6000);
    const parsed = JSON.parse(stdout || "{}");
    result.healthOk = parsed?.status === "ok";
    result.postgresOk = parsed?.checks?.postgres === "ok";
    result.redisOk = parsed?.checks?.redis === "ok";
  } catch (err) {
    result.errors.push(`health:${err.message}`);
  }

  try {
    const { stdout } = await sh("curl -m 4 -sS http://127.0.0.1:4051/api/dashboard/queue", 7000);
    result.queue = JSON.parse(stdout || "{}");
  } catch (err) {
    result.errors.push(`queue:${err.message}`);
  }

  if (!result.queue) {
    try {
      const { rows } = await pg.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = ANY($1::text[]) AND tags @> ARRAY['ai']::text[])::int AS tag_ai,
           COUNT(*) FILTER (WHERE status = ANY($1::text[]) AND tags @> ARRAY['infra']::text[])::int AS tag_infra,
           COUNT(*) FILTER (WHERE status = ANY($1::text[]) AND tags @> ARRAY['io_heavy']::text[])::int AS tag_io_heavy,
           COUNT(*) FILTER (WHERE status = ANY($1::text[]) AND tags @> ARRAY['cpu_heavy']::text[])::int AS tag_cpu_heavy,
           COUNT(*) FILTER (WHERE status='PENDING')::int AS pending,
           COUNT(*) FILTER (WHERE status='DEAD_LETTER')::int AS dead_letter,
           COUNT(*) FILTER (WHERE status='PENDING' AND created_at < NOW() - INTERVAL '60 minutes')::int AS aging_pending_60m
         FROM tasks`,
        [["CREATED", "PENDING", "DISPATCHED", "RUNNING", "RETRY"]]
      );
      if (rows?.[0]) {
        result.queue = rows[0];
        result.errors.push("queue:fallback_db");
      }
    } catch (err) {
      result.errors.push(`queue_db_fallback:${err.message}`);
    }
  }

  return result;
}

function deriveMode(metrics) {
  if (!metrics.healthOk || !metrics.postgresOk || !metrics.redisOk) return "degraded";

  const q = metrics.queue || {};
  const pending = Number(q.pending || 0);
  const oldPending = Number(q["aging>60m PENDING"] || q.aging_pending_60m || 0);
  const dead = Number(q["dead-letter"] || q.dead_letter || 0);

  if (pending >= 120 || oldPending >= 80 || dead >= 150) return "pressure";
  return "steady";
}

function parseNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getLaneBacklog(queue) {
  const q = queue || {};
  return {
    ai: parseNum(q["tag ai"] ?? q.tag_ai ?? q.tags?.ai),
    infra: parseNum(q["tag infra"] ?? q.tag_infra ?? q.tags?.infra),
    ioHeavy: parseNum(q["tag io_heavy"] ?? q.tag_io_heavy ?? q.tags?.io_heavy),
    cpuHeavy: parseNum(q["tag cpu_heavy"] ?? q.tag_cpu_heavy ?? q.tags?.cpu_heavy),
  };
}

function laneAwareTargets(mode, metrics) {
  const targets = {};
  for (const [svc, profile] of Object.entries(SCALABLE_WORKERS)) {
    targets[svc] = profile[mode] || profile.steady;
  }

  const lanes = getLaneBacklog(metrics.queue);
  const agingPending = parseNum(
    metrics?.queue?.["aging>60m PENDING"] ?? metrics?.queue?.aging_pending_60m
  );
  const overrides = [];

  if (lanes.ai >= AI_BACKLOG_THRESHOLD && targets["claw-worker-ai"] < AI_MIN_ON_PRESSURE) {
    overrides.push({
      lane: "ai",
      reason: `ai_backlog=${lanes.ai} threshold=${AI_BACKLOG_THRESHOLD}`,
      service: "claw-worker-ai",
      min_instances: AI_MIN_ON_PRESSURE,
    });
    targets["claw-worker-ai"] = AI_MIN_ON_PRESSURE;
  }

  if (
    lanes.ai >= AI_BACKLOG_THRESHOLD &&
    agingPending >= AI_AGING_PENDING_THRESHOLD &&
    targets["claw-worker-ai"] < AI_SPIKE_TARGET
  ) {
    overrides.push({
      lane: "ai",
      reason: `ai_backlog=${lanes.ai}>=${AI_BACKLOG_THRESHOLD} and aging_pending=${agingPending}>=${AI_AGING_PENDING_THRESHOLD}`,
      service: "claw-worker-ai",
      min_instances: AI_SPIKE_TARGET,
      temporary: true,
    });
    targets["claw-worker-ai"] = AI_SPIKE_TARGET;
  }

  if (lanes.infra >= INFRA_BACKLOG_THRESHOLD && targets["claw-worker-nas"] < INFRA_MIN_ON_PRESSURE) {
    overrides.push({
      lane: "infra",
      reason: `infra_backlog=${lanes.infra} threshold=${INFRA_BACKLOG_THRESHOLD}`,
      service: "claw-worker-nas",
      min_instances: INFRA_MIN_ON_PRESSURE,
    });
    targets["claw-worker-nas"] = INFRA_MIN_ON_PRESSURE;
  }

  return { targets, lanes, overrides, agingPending };
}

async function startIfMissing(name, onlineCount, actions) {
  if ((onlineCount.get(name) || 0) > 0) return;
  try {
    await sh(`pm2 start ecosystem.background.config.js --only ${name}`, 30000);
    actions.push({ type: "start", name, ok: true });
  } catch (err) {
    actions.push({ type: "start", name, ok: false, error: cap(err.message) });
  }
}

async function scaleTo(name, desired, current, actions) {
  if (desired === current) return;
  try {
    await sh(`pm2 scale ${name} ${desired}`, 20000);
    actions.push({ type: "scale", name, from: current, to: desired, ok: true });
  } catch (err) {
    actions.push({ type: "scale", name, from: current, to: desired, ok: false, error: cap(err.message) });
  }
}

async function reduceOverflow(pm2, maxOnline, actions) {
  const online = pm2.filter((p) => p.pm2_env?.status === "online");
  if (online.length <= maxOnline) return;

  const byName = unique(online.map((p) => p.name));
  const stopOrder = [
    ...DEPRIORITIZE.filter((n) => byName.includes(n)),
    ...byName.filter((n) => !PROTECTED.has(n) && !DEPRIORITIZE.includes(n)),
  ];

  let currentOnline = online.length;
  for (const name of stopOrder) {
    if (currentOnline <= maxOnline) break;
    try {
      await sh(`pm2 stop ${name}`, 12000);
      actions.push({ type: "stop", name, reason: "overflow", ok: true });
    } catch (err) {
      actions.push({ type: "stop", name, reason: "overflow", ok: false, error: cap(err.message) });
      continue;
    }
    const refreshed = await getPm2List();
    currentOnline = refreshed.filter((p) => p.pm2_env?.status === "online").length;
  }
}

function writeReport(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const latest = path.join(REPORTS_DIR, "fleet-position-latest.json");
  const stamped = path.join(REPORTS_DIR, `fleet-position-${Date.now()}.json`);
  fs.writeFileSync(latest, JSON.stringify(report, null, 2));
  fs.writeFileSync(stamped, JSON.stringify(report, null, 2));
}

async function cycle() {
  const startedAt = new Date().toISOString();
  const actions = [];
  let pm2 = await getPm2List();

  const metrics = await getHealthAndQueue();
  const mode = deriveMode(metrics);
  const lanePolicy = laneAwareTargets(mode, metrics);

  let onlineCount = countOnlineByName(pm2);

  for (const svc of CORE_SINGLETONS) {
    await startIfMissing(svc, onlineCount, actions);
  }

  pm2 = await getPm2List();
  onlineCount = countOnlineByName(pm2);

  for (const [svc] of Object.entries(SCALABLE_WORKERS)) {
    const desired = Number(lanePolicy.targets[svc] || 1);
    const current = Number(onlineCount.get(svc) || 0);
    if (current === 0) {
      await startIfMissing(svc, onlineCount, actions);
      pm2 = await getPm2List();
      onlineCount = countOnlineByName(pm2);
    }
    const currentAfterStart = Number(onlineCount.get(svc) || 0);
    await scaleTo(svc, desired, currentAfterStart, actions);
  }

  pm2 = await getPm2List();
  let totalOnline = pm2.filter((p) => p.pm2_env?.status === "online").length;

  if (totalOnline < MIN_ONLINE) {
    const refill = [
      "claw-coordinator-watchdog",
      "claw-auto-recovery",
      "claw-global-status-pulse",
      "claw-ai-work-pulse",
    ];
    for (const svc of refill) {
      if (totalOnline >= MIN_ONLINE) break;
      const now = countOnlineByName(pm2);
      await startIfMissing(svc, now, actions);
      pm2 = await getPm2List();
      totalOnline = pm2.filter((p) => p.pm2_env?.status === "online").length;
    }
  }

  await reduceOverflow(pm2, MAX_ONLINE, actions);
  pm2 = await getPm2List();

  const finalOnline = pm2.filter((p) => p.pm2_env?.status === "online").length;
  const report = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    mode,
    lane_backlog: lanePolicy.lanes,
    aging_pending_60m: lanePolicy.agingPending,
    lane_overrides: lanePolicy.overrides,
    worker_targets: lanePolicy.targets,
    min_online: MIN_ONLINE,
    max_online: MAX_ONLINE,
    online_count: finalOnline,
    metrics,
    actions,
    protected: [...PROTECTED],
  };

  writeReport(report);
  console.log(`[fleet-manager] mode=${mode} online=${finalOnline} actions=${actions.length}`);
  return report;
}

async function main() {
  if (ONCE) {
    await cycle();
    return;
  }

  console.log(`[fleet-manager] starting loop interval=${LOOP_SECONDS}s min=${MIN_ONLINE} max=${MAX_ONLINE}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await cycle();
    } catch (err) {
      console.error(`[fleet-manager] cycle failed: ${err.message}`);
    }
    await sleep(LOOP_SECONDS * 1000);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[fleet-manager] fatal:", err);
    process.exit(1);
  });
}

module.exports = { cycle, deriveMode };

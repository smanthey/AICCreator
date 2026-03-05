#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const http = require("http");
const path = require("path");
const fs = require("fs");
const url = require("url");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const pg = require("../infra/postgres");
const { loadConfiguredAppMeta, annotatePm2Process } = require("../control/pm2-runtime-classifier");

const PORT = parseInt(process.env.OPS_PORT || "4060", 10);
const HOST = process.env.OPS_HOST || "127.0.0.1";
const SELF_AWARE_DIR = path.join(__dirname, "../artifacts/self-awareness");
const SELF_AWARE_LATEST = path.join(SELF_AWARE_DIR, "latest.json");
const SELF_MOD_QUEUE = path.join(SELF_AWARE_DIR, "self-mod-queue.json");

function jsonResponse(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readStatic(filePath, contentType = "text/html") {
  try {
    const body = fs.readFileSync(filePath);
    return { ok: true, body, contentType };
  } catch {
    return { ok: false };
  }
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function runPm2Jlist() {
  try {
    const { stdout: raw } = await execAsync("pm2 jlist", { timeout: 8000 });
    const arr = safeJson(raw, []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function q(sql, params = [], fallback = []) {
  try {
    const { rows } = await pg.query(sql, params);
    return rows || fallback;
  } catch {
    return fallback;
  }
}

async function q1(sql, params = [], fallback = {}) {
  const rows = await q(sql, params, []);
  return rows[0] || fallback;
}

async function fetchOverview() {
  const [
    queue,
    failed,
    spendToday,
    spendTrend,
  ] = await Promise.all([
    q1(
      `SELECT COUNT(*)::int AS queue_depth
         FROM tasks
        WHERE COALESCE(status,'') NOT IN ('COMPLETED','FAILED','DEAD_LETTER','CANCELLED')`,
      [],
      { queue_depth: 0 }
    ),
    q1(
      `SELECT COUNT(*)::int AS failed_today
         FROM tasks
        WHERE status IN ('FAILED','DEAD_LETTER')
          AND created_at >= date_trunc('day', now())`,
      [],
      { failed_today: 0 }
    ),
    q(
      `SELECT
         COALESCE(SUM(cost_usd),0)::numeric AS total_usd,
         COALESCE(SUM(CASE WHEN provider='openai' THEN cost_usd ELSE 0 END),0)::numeric AS openai_usd,
         COALESCE(SUM(CASE WHEN provider='deepseek' THEN cost_usd ELSE 0 END),0)::numeric AS deepseek_usd,
         COALESCE(SUM(CASE WHEN provider='gemini' THEN cost_usd ELSE 0 END),0)::numeric AS gemini_usd,
         COALESCE(SUM(CASE WHEN provider='anthropic' THEN cost_usd ELSE 0 END),0)::numeric AS anthropic_usd,
         COALESCE(SUM(CASE WHEN provider='ollama' THEN cost_usd ELSE 0 END),0)::numeric AS ollama_usd
       FROM model_usage
       WHERE created_at >= date_trunc('day', now())`,
      [],
      [{ total_usd: 0, openai_usd: 0, deepseek_usd: 0, gemini_usd: 0, anthropic_usd: 0, ollama_usd: 0 }]
    ),
    q(
      `SELECT
         to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
         provider,
         model_key,
         ROUND(COALESCE(SUM(cost_usd),0)::numeric, 6) AS usd
       FROM model_usage
       WHERE created_at >= date_trunc('day', now()) - interval '13 days'
       GROUP BY 1,2,3
       ORDER BY day ASC, usd DESC`,
      [],
      []
    ),
  ]);

  const pm2 = await runPm2Jlist();
  const running = pm2.filter((p) => (p?.pm2_env?.status || "") === "online").length;

  return {
    generated_at: new Date().toISOString(),
    kpis: {
      running,
      failed_today: toNum(failed.failed_today),
      queue_depth: toNum(queue.queue_depth),
      spend_today_usd: toNum(spendToday[0]?.total_usd),
      spend_openai_usd: toNum(spendToday[0]?.openai_usd),
      spend_deepseek_usd: toNum(spendToday[0]?.deepseek_usd),
      spend_gemini_usd: toNum(spendToday[0]?.gemini_usd),
      spend_anthropic_usd: toNum(spendToday[0]?.anthropic_usd),
      spend_ollama_usd: toNum(spendToday[0]?.ollama_usd),
    },
    spend_series: spendTrend.map((r) => ({
      day: r.day,
      provider: r.provider || "unknown",
      model_key: r.model_key || "unknown",
      usd: toNum(r.usd),
    })),
  };
}

function asMb(memBytes) {
  return Math.round((toNum(memBytes) / (1024 * 1024)) * 10) / 10;
}

function uptimeSecToText(sec) {
  const s = Math.max(0, toNum(sec));
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

async function fetchJobs() {
  const pm2 = await runPm2Jlist();
  const pm2MetaByName = loadConfiguredAppMeta();
  return pm2
    .filter((p) => String(p?.name || "").startsWith("claw-") || String(p?.name || "").startsWith("m1-") || String(p?.name || "").startsWith("i7-"))
    .map((p) => {
      const env = p.pm2_env || {};
      const monit = p.monit || {};
      const runtimeMeta = annotatePm2Process(p, pm2MetaByName);
      return {
        name: p.name,
        status: env.status || "unknown",
        runtime_class: runtimeMeta.runtime_class,
        schedule: runtimeMeta.cron_restart || null,
        restarts: toNum(env.restart_time),
        uptime: uptimeSecToText(toNum(env.pm_uptime) ? (Date.now() - toNum(env.pm_uptime)) / 1000 : 0),
        cpu: toNum(monit.cpu),
        memory_mb: asMb(monit.memory),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchWorkers() {
  const rows = await q(
    `SELECT worker_id, hostname, tags, status, current_jobs_count, last_heartbeat,
            EXTRACT(EPOCH FROM (NOW() - last_heartbeat))::int AS age_seconds,
            capabilities
       FROM device_registry
      WHERE last_heartbeat > NOW() - INTERVAL '24 hours'
      ORDER BY last_heartbeat DESC
      LIMIT 100`,
    [],
    []
  );
  function deriveRole(tags) {
    const t = String(tags || "").toLowerCase();
    if (t.includes("ai")) return "ai_worker";
    if (t.includes("nas") || t.includes("infra")) return "nas_worker";
    return "worker";
  }
  return rows.map((r) => ({
    worker_id: r.worker_id,
    role: deriveRole(r.tags),
    tags: r.tags,
    host: r.hostname,
    status: toNum(r.age_seconds) <= 45 ? "online" : "stale",
    heartbeat_age_sec: toNum(r.age_seconds),
    jobs: toNum(r.current_jobs_count),
    registry_status: r.status || null,
    capabilities: r.capabilities || null,
  }));
}

async function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      resolve(safeJson(raw, {}));
    });
    req.on("error", () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === "GET" && parsed.pathname === "/") {
    const f = readStatic(path.join(__dirname, "../dashboard/ops.html"));
    if (!f.ok) return jsonResponse(res, 404, { error: "dashboard missing" });
    res.writeHead(200, { "Content-Type": f.contentType });
    return res.end(f.body);
  }

  if (req.method === "GET" && parsed.pathname === "/api/overview") {
    const out = await fetchOverview();
    return jsonResponse(res, 200, out);
  }

  if (req.method === "GET" && parsed.pathname === "/api/jobs") {
    return jsonResponse(res, 200, { generated_at: new Date().toISOString(), jobs: await fetchJobs() });
  }

  if (req.method === "GET" && parsed.pathname === "/api/workers") {
    return jsonResponse(res, 200, { generated_at: new Date().toISOString(), workers: await fetchWorkers() });
  }

  if (req.method === "GET" && parsed.pathname === "/api/self-awareness") {
    const latest = readJsonFile(SELF_AWARE_LATEST, null);
    const queue = readJsonFile(SELF_MOD_QUEUE, []);
    return jsonResponse(res, 200, {
      generated_at: new Date().toISOString(),
      latest,
      queue_open: Array.isArray(queue) ? queue.filter((q) => q.status === "queued" || q.status === "in_progress").length : 0,
      queue,
    });
  }

  if (req.method === "POST" && parsed.pathname === "/api/self-mod/request") {
    const body = await readRequestBody(req);
    const title = String(body.title || "").trim();
    const request = String(body.request || "").trim();
    const priority = String(body.priority || "high").trim();
    if (!title || !request) {
      return jsonResponse(res, 400, { error: "title and request are required" });
    }
    const queue = readJsonFile(SELF_MOD_QUEUE, []);
    const id = `smr_${Date.now()}`;
    queue.push({
      id,
      title,
      request,
      priority,
      status: "queued",
      created_at: new Date().toISOString(),
    });
    fs.mkdirSync(SELF_AWARE_DIR, { recursive: true });
    fs.writeFileSync(SELF_MOD_QUEUE, JSON.stringify(queue, null, 2));
    return jsonResponse(res, 200, { ok: true, id, queue_size: queue.length });
  }

  if (req.method === "GET" && parsed.pathname === "/health") {
    return jsonResponse(res, 200, { ok: true, service: "ops-api" });
  }

  jsonResponse(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[ops-api] listening on http://127.0.0.1:${PORT}`);
});

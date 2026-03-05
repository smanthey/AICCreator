#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "production-kpi-flywheel-latest.json");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "PENDING"];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(a, b) {
  if (!b) return 0;
  return a / b;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS production_kpi_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      snapshot_window TEXT NOT NULL DEFAULT '24h',
      score INTEGER NOT NULL DEFAULT 0,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      targets JSONB NOT NULL DEFAULT '{}'::jsonb,
      gaps JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary TEXT,
      report_path TEXT
    )
  `);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS production_kpi_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kpi_key TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      objective TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'opencode_controller',
      task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
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

async function collectMetrics() {
  const { rows: ordersRows } = await pg.query(
    `SELECT
       COUNT(*)::int AS orders_total,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS orders_24h,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS orders_7d,
       COALESCE(SUM(amount_total) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::bigint AS revenue_7d_cents
     FROM orders
     WHERE status NOT IN ('payment_failed', 'refunded')`
  );
  const { rows: sendRows } = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '24 hours')::int AS sends_24h,
       COUNT(*) FILTER (
         WHERE sent_at >= NOW() - INTERVAL '24 hours'
           AND (delivered_at IS NOT NULL OR status = 'delivered')
       )::int AS delivered_24h,
       COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '24 hours' AND opened_at IS NOT NULL)::int AS opened_24h,
       COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '24 hours' AND clicked_at IS NOT NULL)::int AS clicked_24h,
       COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '7 days')::int AS sends_7d
     FROM email_sends`
  );
  const { rows: taskRows } = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '24 hours' AND status = 'COMPLETED')::int AS completed_24h,
       COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '24 hours' AND status = 'FAILED')::int AS failed_24h,
       COUNT(*) FILTER (WHERE status = 'DEAD_LETTER')::int AS dead_letter_open,
       COUNT(*) FILTER (WHERE status IN ('CREATED','PENDING','DISPATCHED','RUNNING'))::int AS queue_active
     FROM tasks`
  );
  const { rows: leadRows } = await pg.query(
    `SELECT
       COUNT(*)::int AS leads_total,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS leads_24h
     FROM leads`
  );
  const { rows: learnRows } = await pg.query(
    `SELECT
       (SELECT COUNT(*)::int FROM pattern_insights WHERE created_at >= NOW() - INTERVAL '24 hours') AS insights_24h,
       (SELECT COUNT(*)::int FROM symbol_feature_playbooks) AS playbooks,
       (SELECT COUNT(DISTINCT feature_key)::int FROM symbol_exemplar_symbols) AS features_indexed`
  ).catch(() => ({ rows: [{}] }));

  const rotation = readJsonSafe(path.join(ROOT, "reports", "daily-feature-rotation-latest.json"));
  const knowledge = readJsonSafe(path.join(ROOT, "reports", "knowledge-troll-harvest-latest.json"));

  const o = ordersRows[0] || {};
  const s = sendRows[0] || {};
  const t = taskRows[0] || {};
  const l = leadRows[0] || {};
  const x = learnRows[0] || {};

  return {
    orders_24h: num(o.orders_24h),
    orders_7d: num(o.orders_7d),
    revenue_7d_cents: num(o.revenue_7d_cents),
    sends_24h: num(s.sends_24h),
    sends_7d: num(s.sends_7d),
    delivery_rate_24h: pct(num(s.delivered_24h), num(s.sends_24h)),
    open_rate_24h: pct(num(s.opened_24h), num(s.sends_24h)),
    click_rate_24h: pct(num(s.clicked_24h), num(s.sends_24h)),
    task_completed_24h: num(t.completed_24h),
    task_failed_24h: num(t.failed_24h),
    task_success_rate_24h: pct(num(t.completed_24h), num(t.completed_24h) + num(t.failed_24h)),
    dead_letter_open: num(t.dead_letter_open),
    queue_active: num(t.queue_active),
    leads_total: num(l.leads_total),
    leads_24h: num(l.leads_24h),
    insights_24h: num(x.insights_24h),
    playbooks: num(x.playbooks),
    features_indexed: num(x.features_indexed),
    feature_upgrades_queued: Array.isArray(rotation?.queued) ? rotation.queued.length : 0,
    repos_discovered: num(knowledge?.repos_discovered),
    papers_discovered: num(knowledge?.papers_discovered),
  };
}

function targetConfig() {
  return {
    orders_7d: num(process.env.KPI_TARGET_ORDERS_7D || 25),
    revenue_7d_cents: num(process.env.KPI_TARGET_REVENUE_7D_CENTS || 250000),
    sends_24h: num(process.env.KPI_TARGET_SENDS_24H || 150),
    delivery_rate_24h: num(process.env.KPI_TARGET_DELIVERY_RATE_24H || 0.9),
    open_rate_24h: num(process.env.KPI_TARGET_OPEN_RATE_24H || 0.12),
    click_rate_24h: num(process.env.KPI_TARGET_CLICK_RATE_24H || 0.02),
    task_success_rate_24h: num(process.env.KPI_TARGET_TASK_SUCCESS_RATE_24H || 0.92),
    queue_active_max: num(process.env.KPI_TARGET_QUEUE_ACTIVE_MAX || 80),
    dead_letter_open_max: num(process.env.KPI_TARGET_DEAD_LETTER_MAX || 5),
    insights_24h: num(process.env.KPI_TARGET_INSIGHTS_24H || 8),
    feature_upgrades_queued: num(process.env.KPI_TARGET_FEATURE_UPGRADES || 40),
  };
}

function computeGaps(metrics, targets) {
  const checks = [
    { key: "orders_7d", current: metrics.orders_7d, target: targets.orders_7d, direction: "gte", weight: 12 },
    { key: "revenue_7d_cents", current: metrics.revenue_7d_cents, target: targets.revenue_7d_cents, direction: "gte", weight: 14 },
    { key: "sends_24h", current: metrics.sends_24h, target: targets.sends_24h, direction: "gte", weight: 10 },
    { key: "delivery_rate_24h", current: metrics.delivery_rate_24h, target: targets.delivery_rate_24h, direction: "gte", weight: 8 },
    { key: "open_rate_24h", current: metrics.open_rate_24h, target: targets.open_rate_24h, direction: "gte", weight: 8 },
    { key: "click_rate_24h", current: metrics.click_rate_24h, target: targets.click_rate_24h, direction: "gte", weight: 10 },
    { key: "task_success_rate_24h", current: metrics.task_success_rate_24h, target: targets.task_success_rate_24h, direction: "gte", weight: 10 },
    { key: "queue_active", current: metrics.queue_active, target: targets.queue_active_max, direction: "lte", weight: 8 },
    { key: "dead_letter_open", current: metrics.dead_letter_open, target: targets.dead_letter_open_max, direction: "lte", weight: 8 },
    { key: "insights_24h", current: metrics.insights_24h, target: targets.insights_24h, direction: "gte", weight: 6 },
    { key: "feature_upgrades_queued", current: metrics.feature_upgrades_queued, target: targets.feature_upgrades_queued, direction: "gte", weight: 6 },
  ];

  let score = 100;
  const gaps = [];

  for (const c of checks) {
    const pass = c.direction === "gte" ? c.current >= c.target : c.current <= c.target;
    if (!pass) {
      const deficit = c.direction === "gte" ? (c.target - c.current) : (c.current - c.target);
      const ratio = c.target > 0 ? deficit / c.target : 1;
      const penalty = c.weight * clamp(ratio, 0.2, 1.5);
      score -= penalty;
      gaps.push({
        key: c.key,
        current: c.current,
        target: c.target,
        direction: c.direction,
        deficit,
        severity: penalty >= 10 ? "high" : penalty >= 6 ? "medium" : "low",
        penalty: Number(penalty.toFixed(2)),
      });
    }
  }

  return {
    score: Math.max(0, Math.round(score)),
    gaps: gaps.sort((a, b) => b.penalty - a.penalty),
  };
}

function buildActionPlan(gaps) {
  const actions = [];
  const keys = new Set(gaps.map((g) => g.key));

  if (keys.has("orders_7d") || keys.has("revenue_7d_cents")) {
    actions.push({
      kpi_key: "orders_revenue",
      severity: "high",
      repo: "local/payclaw",
      objective:
        "Production revenue lift: harden Stripe checkout + webhook reconciliation paths, remove payment friction, and ship 2 concrete conversion upgrades with tests.",
      feature_key: "conversion_revenue",
    });
  }
  if (keys.has("sends_24h") || keys.has("open_rate_24h") || keys.has("click_rate_24h") || keys.has("delivery_rate_24h")) {
    actions.push({
      kpi_key: "send_funnel",
      severity: "high",
      repo: "local/claw-architect",
      objective:
        "Improve outbound funnel KPI: optimize subject/send windows/templates using existing experiment data, then implement the top 2 changes and validate with live send metrics.",
      feature_key: "outreach_funnel",
    });
  }
  if (keys.has("queue_active") || keys.has("dead_letter_open") || keys.has("task_success_rate_24h")) {
    actions.push({
      kpi_key: "throughput_reliability",
      severity: "high",
      repo: "local/claw-architect",
      objective:
        "Reduce backlog and failures: map top failed workflows to symbols, patch root causes, and verify improved queue throughput and success rate.",
      feature_key: "throughput_reliability",
    });
  }
  if (keys.has("insights_24h") || keys.has("feature_upgrades_queued")) {
    actions.push({
      kpi_key: "learning_velocity",
      severity: "medium",
      repo: "local/claw-architect",
      objective:
        "Increase learning velocity: run knowledge harvest + robust pattern build, then add 2 new high-confidence playbook updates for active product repos.",
      feature_key: "learning_velocity",
    });
  }

  return actions;
}

async function queueActions(actions, score) {
  const queued = [];
  const dateKey = new Date().toISOString().slice(0, 13);

  for (const action of actions) {
    const payload = {
      repo: action.repo,
      source: "production_kpi_flywheel",
      feature_key: action.feature_key,
      objective: action.objective,
      quality_target: score < 60 ? 95 : 90,
      max_iterations: 2,
      auto_iterate: true,
      force_implement: true,
      idempotency_key: `kpi:${action.kpi_key}:${dateKey}`,
      evidence: {
        kpi_key: action.kpi_key,
        severity: action.severity,
        score,
      },
    };
    const result = await enqueueTask("opencode_controller", payload);
    queued.push({ ...action, ...result });

    await pg.query(
      `INSERT INTO production_kpi_actions (kpi_key, severity, objective, action_type, task_id, status, metadata)
       VALUES ($1,$2,$3,'opencode_controller',$4,$5,$6::jsonb)`,
      [
        action.kpi_key,
        action.severity,
        action.objective,
        result.created ? result.id : null,
        result.created ? "queued" : "skipped_duplicate",
        JSON.stringify({
          repo: action.repo,
          feature_key: action.feature_key,
          idempotency_key: result.idempotencyKey || null,
          reason: result.reason || null,
        }),
      ]
    );
  }

  return queued;
}

function summaryText(score, gaps, metrics) {
  if (score >= 90) {
    return `Production KPIs strong (score ${score}). Orders7d=${metrics.orders_7d}, revenue7d=$${(metrics.revenue_7d_cents / 100).toFixed(2)}.`;
  }
  if (score >= 75) {
    return `Production KPIs stable with gaps (score ${score}). Top gap: ${gaps[0]?.key || "none"}.`;
  }
  return `Production KPIs need aggressive improvement (score ${score}). Top gaps: ${gaps.slice(0, 3).map((g) => g.key).join(", ")}.`;
}

async function main() {
  await ensureSchema();

  const metrics = await collectMetrics();
  const targets = targetConfig();
  const { score, gaps } = computeGaps(metrics, targets);
  const actionPlan = buildActionPlan(gaps);
  const queuedActions = await queueActions(actionPlan, score);
  const summary = summaryText(score, gaps, metrics);

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    score,
    summary,
    metrics,
    targets,
    gaps,
    action_plan: actionPlan,
    queued_actions: queuedActions,
  };

  await pg.query(
    `INSERT INTO production_kpi_snapshots (snapshot_window, score, metrics, targets, gaps, summary, report_path)
     VALUES ('24h', $1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)`,
    [score, JSON.stringify(metrics), JSON.stringify(targets), JSON.stringify(gaps), summary, REPORT_PATH]
  );

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[production-kpi-flywheel] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const { logIntegrityEvent } = require("../control/integrity-events");
const { fastHealthCheck } = require("../control/coordinator-watchdog");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const RUNNER_REPORT_DIR = path.join(ROOT, "scripts", "reports");
const INTEGRITY_STATE_PATH = path.join(ROOT, "agent-state", "shared-context", "management-integrity-state.json");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const WINDOW_MINUTES = Math.max(
  15,
  Number(getArg("--window-minutes", process.env.PROGRESS_INTEGRITY_WINDOW_MINUTES || "60")) || 60
);
const DOD_LOOKBACK_HOURS = Math.max(
  1,
  Number(getArg("--dod-lookback-hours", process.env.PROGRESS_INTEGRITY_DOD_LOOKBACK_HOURS || "168")) || 168
);
const INCLUDE_RECENT = hasFlag("--recent");
const STATEMENT_TIMEOUT_MS = Math.max(
  3000,
  Number(getArg("--statement-timeout-ms", process.env.PROGRESS_INTEGRITY_STATEMENT_TIMEOUT_MS || "15000")) || 15000
);
const LOCK_TIMEOUT_MS = Math.max(
  500,
  Number(getArg("--lock-timeout-ms", process.env.PROGRESS_INTEGRITY_LOCK_TIMEOUT_MS || "1500")) || 1500
);
const QUERY_TIMEOUT_MS = Math.max(
  2000,
  Number(getArg("--query-timeout-ms", process.env.PROGRESS_INTEGRITY_QUERY_TIMEOUT_MS || "12000")) || 12000
);
const FAIL_OPEN_ON_TIMEOUT = hasFlag("--fail-open-on-timeout") || ["1", "true", "yes", "on"].includes(
  String(process.env.PROGRESS_INTEGRITY_FAIL_OPEN_ON_TIMEOUT || "true").toLowerCase()
);
const isTimeoutError = (message) =>
  /lock timeout|statement timeout|query read timeout|canceling statement due to lock timeout/i.test(String(message || ""));

const LANE_SQL = `
CASE
  WHEN type = 'opencode_controller'
    AND payload->>'source' IN (
      'payclaw_chunk_sms','payclaw_chunk_stripe','payclaw_chunk_api',
      'payclaw_chunk_dashboard','payclaw_chunk_mac_shell','payclaw_chunk_compliance',
      'payclaw_integrity_unblock'
    ) THEN 'payclaw'
  WHEN type = 'opencode_controller'
    AND payload->>'source' IN ('cookiespass_integrity_unblock')
    THEN 'cookiespass'
  WHEN type = 'opencode_controller'
    AND payload->>'source' IN ('gocrawdaddy_integrity_unblock')
    THEN 'gocrawdaddy'
  WHEN payload->>'source' = 'cookiespass_mission_pulse'
    AND type IN ('repo_autofix','site_audit','site_fix_plan','loyalty_send_outreach','loyalty_process_webhooks')
    THEN 'cookiespass'
  WHEN payload->>'source' = 'gocrawdaddy_launch'
    AND type IN ('opencode_controller','research_sync','research_signals','affiliate_research')
    THEN 'gocrawdaddy'
  ELSE NULL
END
`;

const LANE_DOD = {
  cookiespass: [
    { id: "repo_autofix", type: "repo_autofix", source: "cookiespass_mission_pulse" },
    { id: "site_audit", type: "site_audit", source: "cookiespass_mission_pulse" },
    { id: "site_fix_plan", type: "site_fix_plan", source: "cookiespass_mission_pulse" },
    { id: "loyalty_send_outreach", type: "loyalty_send_outreach", source: "cookiespass_mission_pulse" },
    { id: "loyalty_process_webhooks", type: "loyalty_process_webhooks", source: "cookiespass_mission_pulse" },
  ],
  payclaw: [
    { id: "chunk_sms", type: "opencode_controller", source: "payclaw_chunk_sms" },
    { id: "chunk_stripe", type: "opencode_controller", source: "payclaw_chunk_stripe" },
    { id: "chunk_api", type: "opencode_controller", source: "payclaw_chunk_api" },
    { id: "chunk_dashboard", type: "opencode_controller", source: "payclaw_chunk_dashboard" },
    { id: "chunk_mac_shell", type: "opencode_controller", source: "payclaw_chunk_mac_shell" },
    { id: "chunk_compliance", type: "opencode_controller", source: "payclaw_chunk_compliance" },
  ],
  gocrawdaddy: [
    { id: "research_sync", type: "research_sync", source: "gocrawdaddy_launch" },
    { id: "research_signals", type: "research_signals", source: "gocrawdaddy_launch" },
    { id: "affiliate_research", type: "affiliate_research", source: "gocrawdaddy_launch" },
    { id: "opencode_controller", type: "opencode_controller", source: "gocrawdaddy_launch" },
  ],
};

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readLatestRunnerReports() {
  const out = [];
  const names = fs.existsSync(RUNNER_REPORT_DIR) ? fs.readdirSync(RUNNER_REPORT_DIR) : [];
  for (const name of names) {
    if (!name.endsWith("-latest.json")) continue;
    if (!name.startsWith("mission-control-") && !name.startsWith("status-review-")) continue;
    const full = path.join(RUNNER_REPORT_DIR, name);
    const data = readJsonSafe(full);
    if (!data || typeof data !== "object") continue;
    out.push({ file: full, ...data });
  }
  return out;
}

async function querySummary() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT id, type, status, payload, created_at, updated_at, ${LANE_SQL} AS lane
      FROM tasks
      WHERE GREATEST(COALESCE(updated_at, created_at), created_at) > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT lane, type, status, COUNT(*)::int AS n,
           ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))) / 60.0, 1) AS oldest_age_minutes
    FROM scoped
    WHERE lane IS NOT NULL
    GROUP BY lane, type, status
    ORDER BY lane, type, status;
    `,
    [String(WINDOW_MINUTES)]
  );
  return rows;
}

async function queryInFlight() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT id, type, status, payload, created_at, updated_at, ${LANE_SQL} AS lane
      FROM tasks
      WHERE GREATEST(COALESCE(updated_at, created_at), created_at) > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT lane,
           COUNT(*)::int AS in_flight,
           ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))) / 60.0, 1) AS oldest_in_flight_minutes
    FROM scoped
    WHERE lane IS NOT NULL
      AND status IN ('CREATED','DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL')
    GROUP BY lane
    ORDER BY lane;
    `,
    [String(WINDOW_MINUTES)]
  );
  return rows;
}

async function queryBlockers() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT id, type, status, payload, error, last_error, created_at, updated_at, ${LANE_SQL} AS lane
      FROM tasks
      WHERE GREATEST(COALESCE(updated_at, created_at), created_at) > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT id, lane, type, status,
           payload->>'repo' AS repo,
           payload->>'source' AS source,
           COALESCE(NULLIF(error, ''), NULLIF(last_error, '')) AS blocker,
           created_at, updated_at
    FROM scoped
    WHERE lane IS NOT NULL
      AND status IN ('FAILED','RETRY','PENDING_APPROVAL','DEAD_LETTER')
    ORDER BY updated_at DESC
    LIMIT 80;
    `,
    [String(WINDOW_MINUTES)]
  );
  return rows;
}

async function queryDodSignals() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT id, type, status, payload, created_at, ${LANE_SQL} AS lane
      FROM tasks
      WHERE GREATEST(COALESCE(updated_at, created_at), created_at) > NOW() - ($1::text || ' hours')::interval
    )
    SELECT lane, type, payload->>'source' AS source, COUNT(*)::int AS n
    FROM scoped
    WHERE lane IS NOT NULL
      AND status = 'COMPLETED'
    GROUP BY lane, type, payload->>'source'
    ORDER BY lane, type, payload->>'source';
    `,
    [String(DOD_LOOKBACK_HOURS)]
  );
  return rows;
}

async function queryResearchRelevance() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT id, type, status, payload, created_at, ${LANE_SQL} AS lane
      FROM tasks
      WHERE GREATEST(COALESCE(updated_at, created_at), created_at) > NOW() - INTERVAL '48 hours'
        AND ${LANE_SQL} IS NOT NULL
    ),
    research AS (
      SELECT id, lane, type, created_at
      FROM scoped
      WHERE type IN ('research_sync','research_signals','affiliate_research')
    ),
    downstream AS (
      SELECT id, lane, type, created_at
      FROM scoped
      WHERE type IN ('opencode_controller','repo_autofix','site_fix_plan')
    )
    SELECT
      r.lane,
      COUNT(*)::int AS research_tasks,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM downstream d
          WHERE d.lane = r.lane
            AND d.created_at >= r.created_at
            AND d.created_at <= r.created_at + INTERVAL '24 hours'
        )
      )::int AS research_with_downstream
    FROM research r
    GROUP BY r.lane
    ORDER BY r.lane;
    `
  );
  return rows;
}

async function queryRecent() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT id, type, status, payload, created_at, updated_at, ${LANE_SQL} AS lane
      FROM tasks
      WHERE GREATEST(COALESCE(updated_at, created_at), created_at) > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT id, lane, type, status,
           payload->>'repo' AS repo,
           payload->>'source' AS source,
           created_at, updated_at
    FROM scoped
    WHERE lane IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 120;
    `,
    [String(WINDOW_MINUTES)]
  );
  return rows;
}

function aggregateLane(summaryRows, inFlightRows, blockers, reports, dodRows, relevanceRows, prev) {
  const lanes = new Map();

  for (const row of summaryRows) {
    if (!lanes.has(row.lane)) {
      lanes.set(row.lane, {
        lane: row.lane,
        completed: 0,
        failed: 0,
        queued: 0,
        running: 0,
        in_flight: 0,
        oldest_in_flight_minutes: 0,
        blockers: 0,
        completed_with_evidence: 0,
        integrity_blocked: 0,
        blocked_loop: 0,
        symbol_preflight_failed: 0,
        checklist: [],
        checklist_completed: 0,
        checklist_total: 0,
        research_relevance_score: null,
        movement_ok: false,
        escalation_required: false,
        pretend_work_signals: [],
      });
    }
    const lane = lanes.get(row.lane);
    const n = Number(row.n || 0);
    if (row.status === "COMPLETED") lane.completed += n;
    if (["FAILED", "DEAD_LETTER"].includes(row.status)) lane.failed += n;
    if (["CREATED", "DISPATCHED"].includes(row.status)) lane.queued += n;
    if (["RUNNING", "RETRY", "PENDING_APPROVAL"].includes(row.status)) lane.running += n;
  }

  const inflightByLane = new Map(inFlightRows.map((r) => [r.lane, r]));
  const blockersByLane = new Map();
  for (const b of blockers) {
    blockersByLane.set(b.lane, (blockersByLane.get(b.lane) || 0) + 1);
  }

  for (const lane of lanes.values()) {
    lane.in_flight = lane.queued + lane.running;
    lane.oldest_in_flight_minutes = Number(inflightByLane.get(lane.lane)?.oldest_in_flight_minutes || 0);
    lane.blockers = Number(blockersByLane.get(lane.lane) || 0);
  }

  for (const r of reports) {
    const laneName = r?.integrity?.lane;
    if (!laneName || !lanes.has(laneName)) continue;
    const lane = lanes.get(laneName);
    if (r.integrity?.evidence?.ok) lane.completed_with_evidence += 1;
    if (r.integrity?.status === "BLOCKED") lane.integrity_blocked += 1;
    if (r.integrity?.loop?.blocked_loop) lane.blocked_loop += 1;
    if (r.integrity?.symbol_preflight?.required && !r.integrity?.symbol_preflight?.ok) {
      lane.symbol_preflight_failed += 1;
    }
  }

  const dodByLane = new Map();
  for (const row of dodRows) {
    const key = `${row.type}::${row.source || ""}`;
    if (!dodByLane.has(row.lane)) dodByLane.set(row.lane, new Map());
    dodByLane.get(row.lane).set(key, Number(row.n || 0));
  }

  for (const laneName of Object.keys(LANE_DOD)) {
    if (!lanes.has(laneName)) {
      lanes.set(laneName, {
        lane: laneName,
        completed: 0,
        failed: 0,
        queued: 0,
        running: 0,
        in_flight: 0,
        oldest_in_flight_minutes: 0,
        blockers: 0,
        completed_with_evidence: 0,
        integrity_blocked: 0,
        blocked_loop: 0,
        symbol_preflight_failed: 0,
        checklist: [],
        checklist_completed: 0,
        checklist_total: 0,
        research_relevance_score: null,
        movement_ok: false,
        escalation_required: false,
        pretend_work_signals: [],
      });
    }

    const lane = lanes.get(laneName);
    const rowMap = dodByLane.get(laneName) || new Map();
    const list = [];
    for (const item of LANE_DOD[laneName]) {
      const key = `${item.type}::${item.source || ""}`;
      const count = Number(rowMap.get(key) || 0);
      const done = count > 0;
      list.push({ id: item.id, type: item.type, source: item.source, done, count });
    }
    lane.checklist = list;
    lane.checklist_total = list.length;
    lane.checklist_completed = list.filter((x) => x.done).length;
  }

  const relevanceByLane = new Map();
  for (const r of relevanceRows) {
    const total = Number(r.research_tasks || 0);
    const used = Number(r.research_with_downstream || 0);
    const score = total > 0 ? Number(((used / total) * 100).toFixed(1)) : null;
    relevanceByLane.set(r.lane, {
      research_tasks: total,
      research_with_downstream: used,
      relevance_score: score,
    });
  }

  const prevByLane = new Map((prev?.lanes || []).map((x) => [x.lane, x]));

  for (const lane of lanes.values()) {
    const rel = relevanceByLane.get(lane.lane);
    lane.research_relevance_score = rel?.relevance_score ?? null;

    const prevLane = prevByLane.get(lane.lane) || {};
    const completedDelta = Number(lane.completed_with_evidence || 0) - Number(prevLane.completed_with_evidence || 0);
    const ageDelta = Number(prevLane.oldest_in_flight_minutes || 0) - Number(lane.oldest_in_flight_minutes || 0);
    const blockerDelta = Number(prevLane.blockers || 0) - Number(lane.blockers || 0);

    const movement = completedDelta > 0 || ageDelta > 0 || blockerDelta > 0 || lane.checklist_completed === lane.checklist_total;
    lane.movement_ok = Boolean(movement);
    lane.escalation_required = !lane.movement_ok;

    if (lane.completed > 0 && lane.completed_with_evidence === 0) {
      lane.pretend_work_signals.push("completed_without_evidence");
    }
    if (lane.blocked_loop > 0) {
      lane.pretend_work_signals.push("duplicate_output_loop_detected");
    }
    if (lane.symbol_preflight_failed > 0) {
      lane.pretend_work_signals.push("symbol_preflight_missing");
    }
    if (lane.research_relevance_score != null && lane.research_relevance_score === 0) {
      lane.pretend_work_signals.push("research_not_linked_to_downstream_code");
    }
    if (!lane.movement_ok) {
      lane.pretend_work_signals.push("sla_no_net_movement");
    }
  }

  return Array.from(lanes.values()).sort((a, b) => a.lane.localeCompare(b.lane));
}

function writeReport(jsonReport) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-progress-integrity-audit.json`);
  const latestJson = path.join(REPORT_DIR, "progress-integrity-audit-latest.json");
  const latestMd = path.join(REPORT_DIR, "progress-integrity-audit-latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(jsonReport, null, 2));

  const md = [
    "# Progress Integrity Audit",
    "",
    `- generated_at: ${jsonReport.generated_at}`,
    `- window_minutes: ${jsonReport.window_minutes}`,
    `- escalations: ${jsonReport.escalations.length}`,
    "",
    "## Lanes",
    "",
    ...jsonReport.lanes.map((l) =>
      `- ${l.lane}: completed=${l.completed} evidence_completed=${l.completed_with_evidence} blockers=${l.blockers} in_flight=${l.in_flight} oldest_in_flight_min=${l.oldest_in_flight_minutes} checklist=${l.checklist_completed}/${l.checklist_total} movement_ok=${l.movement_ok} relevance=${l.research_relevance_score == null ? "n/a" : `${l.research_relevance_score}%`}`
    ),
    "",
    "## Pretend Work Signals",
    "",
    ...(jsonReport.pretend_work_signals.length
      ? jsonReport.pretend_work_signals.map((x) => `- lane=${x.lane} signal=${x.signal}`)
      : ["- none"]),
    "",
    "## Escalations",
    "",
    ...(jsonReport.escalations.length
      ? jsonReport.escalations.map((x) => `- lane=${x.lane} reason=${x.reason} action=${x.action}`)
      : ["- none"]),
    "",
  ].join("\n");

  fs.writeFileSync(latestMd, md);
  return { jsonPath, latestJson, latestMd };
}

function applyImmediateLaneQuarantine(pretendWorkSignals, integrityState) {
  const quarantineLanes = new Set(
    (pretendWorkSignals || [])
      .filter((x) => x && x.signal === "completed_without_evidence" && x.lane)
      .map((x) => String(x.lane))
  );

  const state = integrityState && typeof integrityState === "object"
    ? integrityState
    : { version: 1, entries: {}, lane_entries: {}, global_lane_quarantine: {}, quarantine_queue: [] };
  state.global_lane_quarantine = state.global_lane_quarantine || {};
  state.quarantine_queue = Array.isArray(state.quarantine_queue) ? state.quarantine_queue : [];

  const now = new Date().toISOString();
  const quarantined = [];
  let changed = false;

  for (const lane of quarantineLanes) {
    const existing = state.global_lane_quarantine[lane] || {};
    const alreadyActive = existing.active === true && existing.reason === "COMPLETED_WITHOUT_EVIDENCE";
    state.global_lane_quarantine[lane] = {
      active: true,
      reason: "COMPLETED_WITHOUT_EVIDENCE",
      required_action: "Lane is auto-quarantined. Attach evidence (commit SHA, diff stats, passing test output, or artifact path), then manually release quarantine.",
      source: "progress_integrity_audit",
      at: now,
    };
    quarantined.push(lane);
    if (!alreadyActive) {
      changed = true;
      state.quarantine_queue.push({
        at: now,
        lane,
        reason: "COMPLETED_WITHOUT_EVIDENCE",
        required_action: "Attach evidence and manually release lane quarantine.",
        source: "progress_integrity_audit",
      });
    }
  }

  if (state.quarantine_queue.length > 400) {
    state.quarantine_queue = state.quarantine_queue.slice(-400);
  }

  return { state, changed, quarantined_lanes: Array.from(new Set(quarantined)).sort() };
}

function laneRepoSource(lane) {
  const key = String(lane || "").toLowerCase();
  if (key === "payclaw") return { repo: "payclaw", source: "payclaw_integrity_unblock" };
  if (key === "cookiespass") return { repo: "cookiespass", source: "cookiespass_integrity_unblock" };
  if (key === "gocrawdaddy") return { repo: "gocrawdaddy", source: "gocrawdaddy_integrity_unblock" };
  return null;
}

async function createUnblockTaskIfMissing(lane) {
  const ctx = laneRepoSource(lane);
  if (!ctx) return { lane, created: false, reason: "lane_not_supported" };

  const dedupe = `integrity_unblock:${lane}:${new Date().toISOString().slice(0, 10)}`;
  const dueAt = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const objective = [
    `Unblock quarantined ${lane} lane with evidence-first closure.`,
    "Required evidence checklist:",
    "1) commit SHA in target repo",
    "2) changed file list + diff stats",
    "3) passing test command output (exit code 0)",
    "4) artifact/report path",
    "Then run integrity:unquarantine --lane " + lane + " --reason \"evidence attached\".",
  ].join(" ");

  const existing = await pg.query(
    `
    SELECT id
    FROM tasks
    WHERE type = 'opencode_controller'
      AND payload->>'source' = $1
      AND payload->>'idempotency_key' = $2
      AND status IN ('CREATED','DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL')
    LIMIT 1
    `,
    [ctx.source, dedupe]
  );
  if (existing.rows.length) {
    return { lane, created: false, reason: "already_exists", task_id: existing.rows[0].id };
  }

  const payload = {
    repo: ctx.repo,
    source: ctx.source,
    objective,
    owner: "taskmaster_integrity",
    due_at: dueAt,
    acceptance_criteria: [
      "Evidence attached in output JSON",
      "No schema errors",
      "Lane passes progress-integrity-audit without completed_without_evidence",
    ],
    idempotency_key: dedupe,
  };

  const ins = await pg.query(
    `
    INSERT INTO tasks (id, type, payload, status, priority, retry_count, max_retries, created_at, updated_at)
    VALUES (gen_random_uuid(), 'opencode_controller', $1::jsonb, 'CREATED', 9, 0, 3, NOW(), NOW())
    RETURNING id
    `,
    [JSON.stringify(payload)]
  );
  return { lane, created: true, task_id: ins.rows[0]?.id || null, source: ctx.source, repo: ctx.repo };
}

async function main() {
  if (QUERY_TIMEOUT_MS > 0) {
    const rawQuery = pg.query.bind(pg);
    pg.query = (text, values) => {
      if (typeof text === "string") {
        return rawQuery({ text, values, query_timeout: QUERY_TIMEOUT_MS });
      }
      if (text && typeof text === "object" && !Object.prototype.hasOwnProperty.call(text, "query_timeout")) {
        return rawQuery({ ...text, query_timeout: QUERY_TIMEOUT_MS });
      }
      return rawQuery(text, values);
    };
  }
  await pg.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  await pg.query(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  const prev = readJsonSafe(path.join(REPORT_DIR, "progress-integrity-audit-latest.json"));
  const reports = readLatestRunnerReports();
  const integrityState = readJsonSafe(INTEGRITY_STATE_PATH) || {};
  let summaryRows;
  let inFlightRows;
  let blockers;
  let dodRows;
  let relevanceRows;
  let recent;
  let fastHealth;
  try {
    summaryRows = await querySummary();
    inFlightRows = await queryInFlight();
    blockers = await queryBlockers();
    dodRows = await queryDodSignals();
    relevanceRows = await queryResearchRelevance();
    recent = INCLUDE_RECENT ? await queryRecent() : [];
    fastHealth = await fastHealthCheck().catch((err) => ({
      ok: false,
      error: err.message,
      safe_mode: true,
      health_summary: null,
    }));
  } catch (err) {
    const msg = String(err?.message || err || "unknown_error");
    if (FAIL_OPEN_ON_TIMEOUT && isTimeoutError(msg)) {
      const degraded = {
        generated_at: new Date().toISOString(),
        window_minutes: WINDOW_MINUTES,
        degraded: true,
        reason: msg,
        lanes: [],
        blockers: [],
        runner_reports_considered: reports.length,
        quarantine_queue_depth: Array.isArray(integrityState?.quarantine_queue) ? integrityState.quarantine_queue.length : 0,
        pretend_work_signals: [],
        escalations: [],
        unified_state: {
          queue_state: { lanes: [] },
          evidence_state: { completed_with_evidence: 0, completed_total: 0 },
          symbol_usage_state: { preflight_failed_total: 0, blocked_loop_total: 0 },
          health_state: null,
        },
        auto_quarantine: { enabled: true, quarantined_lanes: [], unblock_tasks: [] },
        recent: [],
      };
      const paths = writeReport(degraded);
      console.log(
        JSON.stringify(
          {
            ok: true,
            degraded: true,
            reason: msg,
            report: paths,
          },
          null,
          2
        )
      );
      process.exit(0);
    }
    throw err;
  }

  const lanes = aggregateLane(summaryRows, inFlightRows, blockers, reports, dodRows, relevanceRows, prev);

  const pretendWorkSignals = [];
  const escalations = [];
  for (const lane of lanes) {
    for (const signal of lane.pretend_work_signals || []) {
      pretendWorkSignals.push({ lane: lane.lane, signal });
    }
    if (lane.escalation_required) {
      escalations.push({
        lane: lane.lane,
        reason: "SLA_NO_NET_MOVEMENT",
        action: "Escalate to human owner: provide blocker decision or revised acceptance criteria.",
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    window_minutes: WINDOW_MINUTES,
    lanes,
    blockers,
    runner_reports_considered: reports.length,
    quarantine_queue_depth: Array.isArray(integrityState?.quarantine_queue) ? integrityState.quarantine_queue.length : 0,
    pretend_work_signals: pretendWorkSignals,
    escalations,
    unified_state: {
      queue_state: {
        lanes: lanes.map((l) => ({ lane: l.lane, in_flight: l.in_flight, blockers: l.blockers })),
      },
      evidence_state: {
        completed_with_evidence: lanes.reduce((acc, l) => acc + Number(l.completed_with_evidence || 0), 0),
        completed_total: lanes.reduce((acc, l) => acc + Number(l.completed || 0), 0),
      },
      symbol_usage_state: {
        preflight_failed_total: lanes.reduce((acc, l) => acc + Number(l.symbol_preflight_failed || 0), 0),
        blocked_loop_total: lanes.reduce((acc, l) => acc + Number(l.blocked_loop || 0), 0),
      },
      health_state: fastHealth.health_summary || null,
    },
    auto_quarantine: { enabled: true, quarantined_lanes: [] },
    recent,
  };

  const q = applyImmediateLaneQuarantine(pretendWorkSignals, integrityState);
  if (q.changed) {
    q.state.updated_at = new Date().toISOString();
    writeJsonSafe(INTEGRITY_STATE_PATH, q.state);
  }
  report.auto_quarantine.quarantined_lanes = q.quarantined_lanes;
  report.auto_quarantine.unblock_tasks = [];

  for (const lane of q.quarantined_lanes) {
    const created = await createUnblockTaskIfMissing(lane).catch((err) => ({
      lane,
      created: false,
      reason: `task_create_failed:${err.message}`,
    }));
    report.auto_quarantine.unblock_tasks.push(created);
    await logIntegrityEvent({
      event_type: "AUTO_QUARANTINE",
      lane,
      status: "ACTIVE",
      reason: "COMPLETED_WITHOUT_EVIDENCE",
      actor: "progress_integrity_audit",
      payload: {
        lane,
        created_unblock_task: created,
        signal: "completed_without_evidence",
      },
    }).catch(() => {});
  }

  const paths = writeReport(report);
  const ok = pretendWorkSignals.length === 0 && escalations.length === 0;
  console.log(JSON.stringify({ ok, lanes, pretend_work_signals: pretendWorkSignals.length, escalations: escalations.length, report: paths }, null, 2));
  process.exit(ok ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("[progress-integrity-audit] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.query(`RESET statement_timeout`).catch(() => {});
    await pg.query(`RESET lock_timeout`).catch(() => {});
    await pg.end().catch(() => {});
  });

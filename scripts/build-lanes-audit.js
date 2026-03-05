#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const WINDOW_MINUTES = Math.max(
  15,
  Number(getArg("--window-minutes", process.env.BUILD_AUDIT_WINDOW_MINUTES || "180")) || 180
);
const INCLUDE_RECENT = hasFlag("--recent");

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

async function querySummary() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT
        id,
        type,
        status,
        payload,
        created_at,
        updated_at,
        ${LANE_SQL} AS lane
      FROM tasks
      WHERE created_at > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT
      lane,
      type,
      status,
      COUNT(*)::int AS n,
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
      SELECT
        id,
        type,
        status,
        payload,
        created_at,
        updated_at,
        ${LANE_SQL} AS lane
      FROM tasks
      WHERE created_at > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT
      lane,
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
      SELECT
        id,
        type,
        status,
        payload,
        error,
        last_error,
        created_at,
        updated_at,
        ${LANE_SQL} AS lane
      FROM tasks
      WHERE created_at > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT
      id,
      lane,
      type,
      status,
      payload->>'repo' AS repo,
      payload->>'source' AS source,
      COALESCE(NULLIF(error, ''), NULLIF(last_error, '')) AS blocker,
      created_at,
      updated_at
    FROM scoped
    WHERE lane IS NOT NULL
      AND status IN ('FAILED','RETRY','PENDING_APPROVAL')
    ORDER BY updated_at DESC
    LIMIT 30;
    `,
    [String(WINDOW_MINUTES)]
  );
  return rows;
}

async function queryRecent() {
  const { rows } = await pg.query(
    `
    WITH scoped AS (
      SELECT
        id,
        type,
        status,
        payload,
        created_at,
        updated_at,
        ${LANE_SQL} AS lane
      FROM tasks
      WHERE created_at > NOW() - ($1::text || ' minutes')::interval
    )
    SELECT
      id,
      lane,
      type,
      status,
      payload->>'repo' AS repo,
      payload->>'source' AS source,
      created_at,
      updated_at
    FROM scoped
    WHERE lane IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 80;
    `,
    [String(WINDOW_MINUTES)]
  );
  return rows;
}

function aggregateLane(summaryRows, inFlightRows) {
  const lanes = new Map();
  for (const row of summaryRows) {
    if (!lanes.has(row.lane)) {
      lanes.set(row.lane, {
        lane: row.lane,
        completed: 0,
        failed: 0,
        running: 0,
        queued: 0,
      });
    }
    const lane = lanes.get(row.lane);
    const n = Number(row.n || 0);
    if (row.status === "COMPLETED") lane.completed += n;
    if (row.status === "FAILED") lane.failed += n;
    if (["CREATED", "DISPATCHED"].includes(row.status)) lane.queued += n;
    if (["RUNNING", "RETRY", "PENDING_APPROVAL"].includes(row.status)) lane.running += n;
  }

  const inflightByLane = new Map(inFlightRows.map((r) => [r.lane, r]));
  for (const lane of lanes.values()) {
    lane.in_flight = lane.queued + lane.running;
    lane.oldest_in_flight_minutes = Number(inflightByLane.get(lane.lane)?.oldest_in_flight_minutes || 0);
    lane.ok = lane.failed === 0;
  }
  return Array.from(lanes.values()).sort((a, b) => a.lane.localeCompare(b.lane));
}

function writeReport(jsonReport, laneRows) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-build-lanes-audit.json`);
  const latestJson = path.join(REPORT_DIR, "build-lanes-audit-latest.json");
  const latestMd = path.join(REPORT_DIR, "build-lanes-audit-latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(jsonReport, null, 2));

  const md = [
    "# Build Lanes Audit",
    "",
    `- generated_at: ${jsonReport.generated_at}`,
    `- window_minutes: ${jsonReport.window_minutes}`,
    "",
    "## Lanes",
    "",
    ...laneRows.map((r) =>
      `- ${r.lane}: completed=${r.completed} failed=${r.failed} queued=${r.queued} running=${r.running} in_flight=${r.in_flight} oldest_in_flight_min=${r.oldest_in_flight_minutes}`
    ),
    "",
    "## Blockers",
    "",
    ...(jsonReport.blockers.length
      ? jsonReport.blockers.map((b) => `- ${b.lane} ${b.type} ${b.status} repo=${b.repo || "-"} blocker=${b.blocker || "n/a"}`)
      : ["- none"]),
    "",
  ].join("\n");

  fs.writeFileSync(latestMd, md);
  return { jsonPath, latestJson, latestMd };
}

async function main() {
  const summaryRows = await querySummary();
  const inFlightRows = await queryInFlight();
  const blockers = await queryBlockers();
  const recent = INCLUDE_RECENT ? await queryRecent() : [];
  const lanes = aggregateLane(summaryRows, inFlightRows);

  const report = {
    generated_at: new Date().toISOString(),
    window_minutes: WINDOW_MINUTES,
    lanes,
    summary_rows: summaryRows,
    blockers,
    recent,
  };

  const paths = writeReport(report, lanes);
  const ok = blockers.length === 0 && lanes.every((x) => x.failed === 0);
  console.log(JSON.stringify({ ok, lanes, blockers: blockers.length, report: paths }, null, 2));
}

main()
  .catch((err) => {
    console.error("[build-lanes-audit] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

#!/usr/bin/env node
"use strict";

const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { Pool } = require("pg");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f, fallback = null) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : fallback;
};

const STRICT = !hasFlag("--soft");
const REPO_SCAN_MAX_AGE_HOURS = Math.max(1, Number(getArg("--repo-scan-max-age-hours", process.env.GLOBAL_STATUS_REPO_SCAN_MAX_AGE_HOURS || "48")) || 48);
const CREDIT_ACTIVITY_MAX_AGE_HOURS = Math.max(1, Number(getArg("--credit-max-age-hours", process.env.GLOBAL_STATUS_CREDIT_ACTIVITY_MAX_AGE_HOURS || "24")) || 24);
const LEAD_ACTIVITY_MAX_AGE_HOURS = Math.max(1, Number(getArg("--lead-max-age-hours", process.env.GLOBAL_STATUS_LEAD_ACTIVITY_MAX_AGE_HOURS || "48")) || 48);
const URL_TIMEOUT_MS = Math.max(2000, Number(getArg("--url-timeout-ms", process.env.GLOBAL_STATUS_URL_TIMEOUT_MS || "10000")) || 10000);
const E2E_MAX_AGE_HOURS = Math.max(1, Number(getArg("--e2e-max-age-hours", process.env.GLOBAL_STATUS_E2E_MAX_AGE_HOURS || "24")) || 24);
const REQUIRE_E2E_NO_SKIP = String(process.env.GLOBAL_STATUS_REQUIRE_E2E_NO_SKIP || "false").toLowerCase() === "true";
const REQUIRE_CREDIT_OAUTH = String(process.env.GLOBAL_STATUS_REQUIRE_CREDIT_OAUTH || "false").toLowerCase() === "true";
const SCHEDULER_MAX_AGE_MIN = Math.max(10, Number(getArg("--scheduler-max-age-min", process.env.GLOBAL_STATUS_SCHEDULER_MAX_AGE_MIN || "90")) || 90);
const WORKER_HEARTBEAT_MAX_SECONDS = Math.max(
  60,
  Number(getArg("--worker-heartbeat-max-seconds", process.env.GLOBAL_STATUS_WORKER_HEARTBEAT_MAX_SECONDS || "180")) || 180
);
const EXTERNAL_CHAT_CHANNELS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.EXTERNAL_CHAT_CHANNELS_ENABLED || "false").toLowerCase()
);

const REQUIRED_PM2 = [
  "claw-dispatcher",
  "claw-webhook-server",
  "claw-worker-ai",
  "claw-worker-nas",
  "claw-lead-autopilot-skynpatch",
  "claw-lead-autopilot-bws",
  ...(EXTERNAL_CHAT_CHANNELS_ENABLED ? ["claw-gateway"] : []),
];

function parseUrlList() {
  const envUrls = String(process.env.GLOBAL_STATUS_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cliUrls = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--url" && args[i + 1]) cliUrls.push(String(args[i + 1]).trim());
  }
  return [...new Set([...envUrls, ...cliUrls])];
}

async function pm2List() {
  const { stdout } = await execAsync("pm2 jlist", { encoding: "utf8" });
  const arr = JSON.parse(stdout || "[]");
  return Array.isArray(arr) ? arr : [];
}

function mark(checks, subsystem, status, detail) {
  checks.push({ subsystem, status, detail });
}

async function checkUrls(urls) {
  const out = [];
  for (const url of urls) {
    const started = Date.now();
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(URL_TIMEOUT_MS) });
      const ms = Date.now() - started;
      const ok = res.status >= 200 && res.status < 500;
      out.push({ url, ok, status: res.status, latency_ms: ms });
    } catch (err) {
      out.push({ url, ok: false, status: 0, latency_ms: Date.now() - started, error: err.message });
    }
  }
  return out;
}

function latestLaunchE2EReport() {
  const reportDir = path.join(__dirname, "reports");
  if (!fs.existsSync(reportDir)) return null;
  const files = fs.readdirSync(reportDir)
    .filter((f) => f.endsWith("-launch-e2e-matrix.json"))
    .sort();
  if (!files.length) return null;
  const file = files[files.length - 1];
  const abs = path.join(reportDir, file);
  try {
    const json = JSON.parse(fs.readFileSync(abs, "utf8"));
    return { file: abs, data: json };
  } catch {
    return null;
  }
}

async function main() {
  const pool = new Pool({
    host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST,
    port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
    database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
    user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
    password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    max: 2,
  });

  const checks = [];
  const urls = parseUrlList();

  try {
    const procs = await pm2List();
    const statusByName = new Map(procs.map((p) => [p.name, p.pm2_env?.status || "unknown"]));
    for (const name of REQUIRED_PM2) {
      if (statusByName.get(name) !== "online") {
        mark(checks, "pm2", "RED", `${name} status=${statusByName.get(name) || "missing"}`);
      } else {
        mark(checks, "pm2", "GREEN", `${name} online`);
      }
    }

    const { rows: topologyRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE status IN ('ready','busy')
             AND NOW() - last_heartbeat <= ($1::int * INTERVAL '1 second')
         )::int AS active_workers,
         COUNT(*) FILTER (
           WHERE status IN ('ready','busy')
             AND NOW() - last_heartbeat <= ($1::int * INTERVAL '1 second')
             AND (
               (capabilities->>'node_role')='ai_worker'
               OR (tags @> ARRAY['ai']::text[])
             )
         )::int AS active_ai,
         COUNT(*) FILTER (
           WHERE status IN ('ready','busy')
             AND NOW() - last_heartbeat <= ($1::int * INTERVAL '1 second')
             AND (
               (capabilities->>'node_role')='nas_worker'
               OR (tags @> ARRAY['infra']::text[] AND tags @> ARRAY['deterministic']::text[] AND tags @> ARRAY['io_heavy']::text[])
             )
         )::int AS active_nas
       FROM device_registry`
      ,
      [WORKER_HEARTBEAT_MAX_SECONDS]
    );
    const t = topologyRows[0] || {};
    if (Number(t.active_workers || 0) < 2 || Number(t.active_ai || 0) < 1 || Number(t.active_nas || 0) < 1) {
      mark(checks, "workers", "RED", `active=${t.active_workers || 0} ai=${t.active_ai || 0} nas=${t.active_nas || 0}`);
    } else {
      mark(checks, "workers", "GREEN", `active=${t.active_workers} ai=${t.active_ai} nas=${t.active_nas}`);
    }

    const { rows: schemaRows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM pg_constraint WHERE NOT convalidated)::int AS invalid_constraints,
         (SELECT count(*) FROM pg_index WHERE NOT indisvalid)::int AS invalid_indexes,
         GREATEST(
           (SELECT COUNT(*)::int FROM (SELECT 1 FROM schema_migrations) s),
           0
         )::int AS applied_migrations`
    );
    const s = schemaRows[0] || {};
    if (Number(s.invalid_constraints || 0) > 0 || Number(s.invalid_indexes || 0) > 0) {
      mark(checks, "schema", "RED", `invalid_constraints=${s.invalid_constraints || 0} invalid_indexes=${s.invalid_indexes || 0}`);
    } else {
      mark(checks, "schema", "GREEN", "no invalid constraints/indexes");
    }

    const { rows: repoRows } = await pool.query(
      `SELECT
         id, status, repos_scanned, pass_count, fail_count,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(finished_at, started_at)))/3600.0 AS age_h
       FROM github_repo_scan_runs
       WHERE status = 'completed'
       ORDER BY finished_at DESC NULLS LAST, started_at DESC
       LIMIT 1`
    );
    if (!repoRows[0]) {
      mark(checks, "repo_audit", "RED", "no completed github scan run found");
    } else {
      const r = repoRows[0];
      if (Number(r.age_h || 9999) > REPO_SCAN_MAX_AGE_HOURS) {
        mark(checks, "repo_audit", "RED", `latest completed scan too old (${Number(r.age_h).toFixed(1)}h)`);
      } else if (Number(r.fail_count || 0) > 0) {
        mark(checks, "repo_audit", "RED", `latest scan has fail_count=${r.fail_count}`);
      } else {
        mark(checks, "repo_audit", "GREEN", `repos_scanned=${r.repos_scanned} pass=${r.pass_count} fail=${r.fail_count} age_h=${Number(r.age_h).toFixed(1)}`);
      }
    }

    const { rows: creditRows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM credit_reports) AS reports,
         (SELECT COUNT(*)::int FROM credit_issues WHERE status='open') AS open_issues,
         (SELECT COUNT(*)::int FROM credit_actions WHERE status IN ('queued','blocked','draft','sent')) AS active_actions,
         (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/3600.0 FROM credit_actions) AS action_age_h`
    );
    const c = creditRows[0] || {};
    if (Number(c.reports || 0) === 0) {
      mark(checks, "credit", STRICT ? "RED" : "YELLOW", "no credit reports loaded");
    } else if (Number(c.open_issues || 0) > 0 && Number(c.active_actions || 0) === 0) {
      mark(
        checks,
        "credit",
        STRICT ? "RED" : "YELLOW",
        `open_issues=${c.open_issues} but no active actions`
      );
    } else if (c.action_age_h != null && Number(c.action_age_h) > CREDIT_ACTIVITY_MAX_AGE_HOURS) {
      mark(checks, "credit", "RED", `credit actions stale age_h=${Number(c.action_age_h).toFixed(1)}`);
    } else {
      mark(checks, "credit", "GREEN", `reports=${c.reports} open_issues=${c.open_issues} active_actions=${c.active_actions}`);
    }
    if (REQUIRE_CREDIT_OAUTH) {
      const hasOauth =
        Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID) &&
        Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
        Boolean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
      if (!hasOauth) {
        mark(checks, "credit_oauth", "RED", "missing GOOGLE_OAUTH_* env for production send/reply loop");
      } else {
        try {
          const { getGmail } = require("../infra/gmail-client");
          const gmail = getGmail();
          await gmail.users.getProfile({ userId: "me" });
          mark(checks, "credit_oauth", "GREEN", "oauth token refresh valid");
        } catch (err) {
          const detail = String(
            err?.response?.data?.error ||
            err?.response?.data?.error_description ||
            err?.message ||
            "oauth_invalid"
          );
          mark(checks, "credit_oauth", "RED", detail);
        }
      }
    } else {
      mark(checks, "credit_oauth", "YELLOW", "not enforced (set GLOBAL_STATUS_REQUIRE_CREDIT_OAUTH=true)");
    }

    const { rows: leadRows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM leads WHERE brand_slug='skynpatch') AS total_leads,
         (SELECT COUNT(*)::int FROM leads WHERE brand_slug='skynpatch' AND email IS NOT NULL AND email <> '') AS leads_with_email,
         (SELECT COUNT(*)::int FROM email_sends WHERE brand_slug='skynpatch') AS total_sends,
         (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(sent_at)))/3600.0 FROM email_sends WHERE brand_slug='skynpatch') AS last_send_age_h`
    );
    const l = leadRows[0] || {};
    if (Number(l.total_leads || 0) === 0) {
      mark(checks, "lead", "RED", "no skynpatch leads");
    } else if (Number(l.leads_with_email || 0) === 0) {
      mark(checks, "lead", "RED", "no leads with email");
    } else if (Number(l.total_sends || 0) === 0) {
      mark(checks, "lead", STRICT ? "RED" : "YELLOW", "no outbound sends yet");
    } else if (l.last_send_age_h != null && Number(l.last_send_age_h) > LEAD_ACTIVITY_MAX_AGE_HOURS) {
      mark(checks, "lead", "RED", `last send too old age_h=${Number(l.last_send_age_h).toFixed(1)}`);
    } else {
      mark(checks, "lead", "GREEN", `leads=${l.total_leads} with_email=${l.leads_with_email} sends=${l.total_sends}`);
    }

    const webhookHealth = await fetch("http://127.0.0.1:4040/api/webhook/maileroo", {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    }).then((r) => ({ ok: r.status >= 200 && r.status < 500, status: r.status }))
      .catch((e) => ({ ok: false, status: 0, error: e.message }));
    if (!webhookHealth.ok) {
      mark(checks, "webhook", "RED", `local webhook check failed status=${webhookHealth.status}${webhookHealth.error ? ` err=${webhookHealth.error}` : ""}`);
    } else {
      mark(checks, "webhook", "GREEN", `local webhook reachable status=${webhookHealth.status}`);
    }

    if (EXTERNAL_CHAT_CHANNELS_ENABLED) {
      const telegramToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
      if (!telegramToken) {
        mark(checks, "telegram_bot", STRICT ? "RED" : "YELLOW", "TELEGRAM_BOT_TOKEN missing");
      } else {
        const tg = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        })
          .then(async (r) => {
            const j = await r.json().catch(() => ({}));
            return { ok: r.ok && j?.ok === true, status: r.status, json: j };
          })
          .catch((e) => ({ ok: false, status: 0, error: e.message }));
        if (!tg.ok) {
          const detail =
            tg.error ||
            tg?.json?.description ||
            `status=${tg.status}`;
          mark(checks, "telegram_bot", "RED", `telegram api check failed: ${detail}`);
        } else {
          const username = tg?.json?.result?.username || "(no username)";
          mark(checks, "telegram_bot", "GREEN", `telegram api ok @${username}`);
        }
      }
    } else {
      mark(checks, "telegram_bot", "GREEN", "external channels disabled; dashboard chat is primary");
    }

    if (!urls.length) {
      mark(checks, "website_uptime", STRICT ? "RED" : "YELLOW", "no GLOBAL_STATUS_URLS configured");
    } else {
      const results = await checkUrls(urls);
      const bad = results.filter((r) => !r.ok);
      if (bad.length) {
        mark(checks, "website_uptime", "RED", bad.map((b) => `${b.url} status=${b.status}${b.error ? ` err=${b.error}` : ""}`).join(" | "));
      } else {
        mark(
          checks,
          "website_uptime",
          "GREEN",
          results.map((r) => `${r.url} ${r.status} ${r.latency_ms}ms`).join(" | ")
        );
      }
    }

    const e2e = latestLaunchE2EReport();
    if (!e2e) {
      mark(checks, "launch_e2e", STRICT ? "RED" : "YELLOW", "no launch e2e matrix report found");
    } else {
      const ageH = (Date.now() - new Date(e2e.data.generated_at || 0).getTime()) / (1000 * 60 * 60);
      if (!Number.isFinite(ageH) || ageH > E2E_MAX_AGE_HOURS) {
        mark(checks, "launch_e2e", "RED", `launch e2e report too old age_h=${Number(ageH || 9999).toFixed(1)}`);
      } else if (REQUIRE_E2E_NO_SKIP && Number(e2e.data.skipped_checks || 0) > 0) {
        mark(checks, "launch_e2e", "RED", `launch e2e skipped_checks=${e2e.data.skipped_checks}`);
      } else if (Number((e2e.data.blocking_failures ?? e2e.data.failures ?? 0)) > 0) {
        mark(
          checks,
          "launch_e2e",
          "RED",
          `launch e2e blocking_failures=${Number((e2e.data.blocking_failures ?? e2e.data.failures ?? 0))} total_failures=${Number(e2e.data.failures || 0)}`
        );
      } else {
        mark(
          checks,
          "launch_e2e",
          "GREEN",
          `launch e2e pass targets=${e2e.data.targets} failures=${Number(e2e.data.failures || 0)} age_h=${ageH.toFixed(1)}`
        );
      }
    }

    const { rows: schedRows } = await pool.query(
      `WITH expected(step_name, max_age_min) AS (
         VALUES
           ('status_redgreen', 60),
           ('github_scan', 240),
           ('repo_normalize_queue', 120),
           ('git_sites_pulse', 120),
           ('flow_regression_pulse', 180),
           ('regression_autofix_pulse', 180),
           ('security_sweep', 480),
           ('security_remediation_queue', 480),
           ('ai_work_pulse', 180)
       ),
       latest AS (
         SELECT step_name, MAX(started_at) AS last_run
         FROM orchestrator_step_runs
         WHERE runner = 'backlog_orchestrator'
         GROUP BY step_name
       )
       SELECT
         e.step_name,
         e.max_age_min,
         l.last_run,
         EXTRACT(EPOCH FROM (NOW() - l.last_run))/60.0 AS age_min
       FROM expected e
       LEFT JOIN latest l ON l.step_name = e.step_name`
    );
    const stale = [];
    const missing = [];
    for (const r of schedRows) {
      const maxAge = Math.max(Number(r.max_age_min || 0), SCHEDULER_MAX_AGE_MIN);
      if (!r.last_run) {
        missing.push(r.step_name);
        continue;
      }
      if (Number(r.age_min || 0) > maxAge) {
        stale.push(`${r.step_name}:${Number(r.age_min).toFixed(1)}m`);
      }
    }
    if (missing.length || stale.length) {
      mark(
        checks,
        "scheduler",
        "RED",
        `missing=${missing.join(",") || "none"} stale=${stale.join(",") || "none"}`
      );
    } else {
      mark(checks, "scheduler", "GREEN", `fresh_steps=${schedRows.length} max_age_floor_min=${SCHEDULER_MAX_AGE_MIN}`);
    }

    const red = checks.filter((c0) => c0.status === "RED");
    const yellow = checks.filter((c0) => c0.status === "YELLOW");
    const green = checks.filter((c0) => c0.status === "GREEN");
    const status = red.length ? "RED" : (yellow.length ? "YELLOW" : "GREEN");

    console.log("\n=== Global Red/Green Status ===\n");
    console.table(checks);
    console.log(`\nstatus=${status} green=${green.length} yellow=${yellow.length} red=${red.length}`);
    if (red.length) {
      console.log("\nRED failures:");
      for (const r of red) console.log(`- [${r.subsystem}] ${r.detail}`);
    }
    if (yellow.length) {
      console.log("\nYELLOW warnings:");
      for (const y of yellow) console.log(`- [${y.subsystem}] ${y.detail}`);
    }

    await pool.end();
    process.exit(red.length ? 1 : 0);
  } catch (err) {
    console.error(`[global-redgreen-status] fatal: ${err.message}`);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
}

main();

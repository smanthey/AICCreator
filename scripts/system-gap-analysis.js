#!/usr/bin/env node
"use strict";

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const STRICT = hasFlag("--strict");
const BRAND = (() => {
  const i = args.indexOf("--brand");
  return i >= 0 ? args[i + 1] : "skynpatch";
})();

function verdict(ok, warn = false) {
  if (ok) return "PASS";
  return warn ? "WARN" : "FAIL";
}

function pushCheck(rows, phase, check, ok, detail, warn = false) {
  rows.push({ phase, check, status: verdict(ok, warn), detail });
}

function latestReport(suffix) {
  const reportDir = path.join(__dirname, "reports");
  if (!fs.existsSync(reportDir)) return null;
  const files = fs.readdirSync(reportDir).filter((f) => f.endsWith(suffix)).sort();
  if (!files.length) return null;
  const abs = path.join(reportDir, files[files.length - 1]);
  try {
    return { file: abs, json: JSON.parse(fs.readFileSync(abs, "utf8")) };
  } catch {
    return null;
  }
}

async function phaseCredit(rows) {
  const r = await pg.query(
    `SELECT
       (SELECT COUNT(*)::int FROM credit_reports) AS reports,
       (SELECT COUNT(*)::int FROM credit_items) AS items,
       (SELECT COUNT(*)::int FROM credit_issues WHERE status='open') AS open_issues,
       (SELECT COUNT(*)::int FROM credit_actions WHERE status IN ('queued','draft','sent','blocked')) AS active_actions,
       (SELECT COUNT(*)::int FROM credit_action_outcomes) AS outcomes,
       (SELECT COUNT(*)::int FROM credit_learning_events) AS learning_events`
  );
  const x = r.rows[0] || {};
  pushCheck(rows, "Credit", "reports_loaded", Number(x.reports || 0) > 0, `reports=${x.reports || 0}`);
  pushCheck(rows, "Credit", "items_parsed", Number(x.items || 0) > 0, `items=${x.items || 0}`);
  pushCheck(rows, "Credit", "issues_actionable", Number(x.open_issues || 0) === 0 || Number(x.active_actions || 0) > 0, `open_issues=${x.open_issues || 0} active_actions=${x.active_actions || 0}`);
  const hasOauth =
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
    Boolean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  pushCheck(rows, "Credit", "gmail_oauth_prod_ready", hasOauth, "requires GOOGLE_OAUTH_* env", true);
  pushCheck(rows, "Credit", "outcome_learning_loop", Number(x.outcomes || 0) > 0 && Number(x.learning_events || 0) > 0, `outcomes=${x.outcomes || 0} learning_events=${x.learning_events || 0}`, true);
}

async function phaseSales(rows) {
  const r = await pg.query(
    `WITH sends AS (
       SELECT * FROM email_sends WHERE brand_slug=$1
     ),
     attributed AS (
       SELECT o.id, s.id AS send_id,
              ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY s.sent_at DESC NULLS LAST) rn
       FROM orders o
       LEFT JOIN sends s
         ON LOWER(s.to_email)=LOWER(o.buyer_email)
        AND s.sent_at <= o.created_at
     )
     SELECT
       (SELECT COUNT(*)::int FROM sends) AS sends,
       (SELECT COUNT(*)::int FROM sends WHERE delivered_at IS NOT NULL OR status='delivered') AS delivered,
       (SELECT COUNT(*)::int FROM sends WHERE opened_at IS NOT NULL) AS opened,
       (SELECT COUNT(*)::int FROM sends WHERE clicked_at IS NOT NULL) AS clicked,
       (SELECT COUNT(*)::int FROM orders) AS orders,
       (SELECT COUNT(*)::int FROM attributed WHERE rn=1 AND send_id IS NOT NULL) AS orders_attributed`,
    [BRAND]
  );
  const x = r.rows[0] || {};
  pushCheck(rows, "Skynpatch", "email_sends_exist", Number(x.sends || 0) > 0, `sends=${x.sends || 0}`);
  pushCheck(rows, "Skynpatch", "delivery_signal", Number(x.delivered || 0) > 0, `delivered=${x.delivered || 0}`, true);
  pushCheck(rows, "Skynpatch", "engagement_signal", Number(x.opened || 0) > 0 || Number(x.clicked || 0) > 0, `opened=${x.opened || 0} clicked=${x.clicked || 0}`, true);
  const attributedOk = Number(x.orders || 0) === 0 || Number(x.orders_attributed || 0) > 0;
  pushCheck(rows, "Skynpatch", "order_attribution", attributedOk, `orders=${x.orders || 0} attributed=${x.orders_attributed || 0}`, true);
}

async function phaseRepo(rows) {
  const run = await pg.query(
    `SELECT id, repos_scanned, pass_count, fail_count, finished_at
     FROM github_repo_scan_runs
     WHERE status='completed'
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`
  );
  const x = run.rows[0];
  if (!x) {
    pushCheck(rows, "RepoNormalization", "strict_scan", false, "no completed scan");
    return;
  }
  pushCheck(rows, "RepoNormalization", "strict_scan", Number(x.fail_count || 0) === 0, `pass=${x.pass_count} fail=${x.fail_count}`);
  const vio = await pg.query(
    `SELECT COUNT(*)::int AS n
     FROM github_repo_violations
     WHERE run_id = $1
       AND code IN ('AUTH_NOT_STANDARDIZED','MULTI_TENANT_BASELINE_MISSING','LEGACY_AUTH_RUNTIME_PRESENT')
       AND severity='critical'`,
    [x.id]
  );
  pushCheck(rows, "RepoNormalization", "critical_baseline_violations", Number(vio.rows[0]?.n || 0) === 0, `critical=${vio.rows[0]?.n || 0}`);
}

async function phaseE2E(rows) {
  const e2e = latestReport("-launch-e2e-matrix.json");
  if (!e2e) {
    pushCheck(rows, "GlobalE2E", "matrix_report_exists", false, "missing report");
    return;
  }
  const failures = Number(e2e.json.blocking_failures ?? e2e.json.failures ?? 0);
  pushCheck(rows, "GlobalE2E", "blocking_failures", failures === 0, `blocking_failures=${failures}`);
  pushCheck(rows, "GlobalE2E", "target_count", Number(e2e.json.targets || 0) >= 10, `targets=${e2e.json.targets || 0}`, true);
}

async function phaseBackground(rows) {
  const req = await pg.query(
    `SELECT
       EXISTS(
         SELECT 1
         FROM device_registry
         WHERE status IN ('ready','busy')
           AND NOW() - last_heartbeat <= INTERVAL '90 seconds'
       ) AS workers_ok,
       EXISTS(SELECT 1 FROM orchestrator_step_runs WHERE step_name='github_scan' AND status='COMPLETED' AND started_at > NOW() - INTERVAL '2 hours') AS github_recent,
       EXISTS(SELECT 1 FROM orchestrator_step_runs WHERE step_name='security_sweep' AND status='COMPLETED' AND started_at > NOW() - INTERVAL '4 hours') AS security_recent,
       EXISTS(SELECT 1 FROM orchestrator_step_runs WHERE step_name='status_redgreen' AND status='COMPLETED' AND started_at > NOW() - INTERVAL '2 hours') AS status_recent`
  );
  const x = req.rows[0] || {};
  pushCheck(rows, "Background", "workers_heartbeat", Boolean(x.workers_ok), `workers_ok=${x.workers_ok}`);
  pushCheck(rows, "Background", "github_pulse_recent", Boolean(x.github_recent), `github_recent=${x.github_recent}`);
  pushCheck(rows, "Background", "security_pulse_recent", Boolean(x.security_recent), `security_recent=${x.security_recent}`);
  pushCheck(rows, "Background", "status_pulse_recent", Boolean(x.status_recent), `status_recent=${x.status_recent}`);
}

async function phaseSecurity(rows) {
  const latest = latestReport("-security-sweep.json");
  if (!latest) {
    pushCheck(rows, "Security", "security_sweep_report", false, "missing report");
    return;
  }
  const failed = Array.isArray(latest.json.steps) ? latest.json.steps.filter((s) => !s.ok).length : 0;
  pushCheck(rows, "Security", "sweep_pass", failed === 0, `failed_steps=${failed}`);
  const rem = await pg.query(
    `SELECT COUNT(*)::int AS n
     FROM tasks
     WHERE type='qa_triage'
       AND payload->>'source'='security_remediation_queue'
       AND status IN ('CREATED','DISPATCHED','RUNNING')`
  );
  pushCheck(rows, "Security", "remediation_queue_active", Number(rem.rows[0]?.n || 0) >= 0, `active_remediation_tasks=${rem.rows[0]?.n || 0}`, true);
}

async function phaseEmailPlatform(rows) {
  const c = await pg.query(
    `SELECT
       (SELECT COUNT(*)::int FROM brands) AS brands,
       (SELECT COUNT(*)::int FROM brands WHERE provisioning_status IN ('queued','provisioning','ready','action_required','failed')) AS provisioning_tasks,
       (SELECT COUNT(*)::int FROM brand_provision_runs WHERE status IN ('running','completed','failed','skipped')) AS provision_runs,
       (SELECT COUNT(*)::int FROM flows) AS flows`
  );
  const x = c.rows[0] || {};
  pushCheck(
    rows,
    "EmailPlatform",
    "control_plane_schema",
    Number(x.brands || 0) >= 0 &&
      Number(x.provisioning_tasks || 0) >= 0 &&
      Number(x.provision_runs || 0) >= 0,
    `brands=${x.brands || 0} provisioning_tasks=${x.provisioning_tasks || 0} provision_runs=${x.provision_runs || 0}`
  );
  pushCheck(rows, "EmailPlatform", "flow_seeded", Number(x.flows || 0) > 0, `flows=${x.flows || 0}`, true);
}

async function main() {
  await pg.connect();
  const checks = [];
  await phaseCredit(checks);
  await phaseSales(checks);
  await phaseRepo(checks);
  await phaseE2E(checks);
  await phaseBackground(checks);
  await phaseSecurity(checks);
  await phaseEmailPlatform(checks);

  const fail = checks.filter((c) => c.status === "FAIL");
  const warn = checks.filter((c) => c.status === "WARN");
  const pass = checks.filter((c) => c.status === "PASS");
  const score = Math.round((pass.length / checks.length) * 100);

  console.log("\n=== Claw System Gap Analysis ===\n");
  console.table(checks);
  console.log(`score=${score} pass=${pass.length} warn=${warn.length} fail=${fail.length}`);

  if (fail.length) {
    console.log("\nHard blockers:");
    for (const f of fail) console.log(`- [${f.phase}] ${f.check}: ${f.detail}`);
  }
  if (warn.length) {
    console.log("\nSoft gaps:");
    for (const w of warn) console.log(`- [${w.phase}] ${w.check}: ${w.detail}`);
  }

  if (STRICT && fail.length > 0) process.exitCode = 2;
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

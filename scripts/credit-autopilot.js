#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { detectIssuesForReport, detectIssuesPreviewForReport, reconcileStaleArtifacts } = require("../control/credit/rules");
const { createActionForIssue, queueDueEchoTasks } = require("../control/credit/workflow");
const { orderIssues } = require("../control/credit/prioritizer");
const { ensureDraftForAction } = require("../control/credit/drafting");
const { insertItems } = require("../control/credit/intake");
const { parseCreditReportText } = require("../control/credit/pdf-parser");
const { ingestFolderForPerson, refreshOpenIssuesForPerson } = require("../control/credit/evidence");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const LIMIT_PROFILES = Math.max(1, Number(getArg("--limit-profiles", process.env.CREDIT_AUTOPILOT_LIMIT_PROFILES || "100")) || 100);
const LIMIT_DEADLINES = Math.max(1, Number(getArg("--limit-deadlines", process.env.CREDIT_AUTOPILOT_LIMIT_DEADLINES || "100")) || 100);
const MAX_REPORTS_PER_PERSON = Math.max(1, Number(getArg("--max-reports-per-person", process.env.CREDIT_AUTOPILOT_MAX_REPORTS_PER_PERSON || "3")) || 3);
const PERSON_KEY = getArg("--person-key", "");
const DRY_RUN = args.includes("--dry-run");
const MONTHLY_BUDGET = Math.max(0, Number(getArg("--monthly-budget", process.env.CREDIT_PHASE2_MONTHLY_BUDGET || "0")) || 0);
const DRAFT_LETTERS = !args.includes("--no-draft-letters");
const LATEST_ONLY = args.includes("--latest-only");
const EVIDENCE_ROOT = getArg("--evidence-root", process.env.CREDIT_EVIDENCE_ROOT || "");

async function targetReports(limitProfiles) {
  const params = [];
  let where = "";
  if (PERSON_KEY) {
    params.push(PERSON_KEY);
    where = `WHERE p.external_key = $${params.length}`;
  }
  params.push(limitProfiles);
  const limitProfilesPos = params.length;
  params.push(MAX_REPORTS_PER_PERSON);
  const perPersonPos = params.length;

  const { rows } = await pg.query(
    `WITH selected_people AS (
       SELECT p.id, p.external_key, p.full_name, p.updated_at
       FROM credit_person_profiles p
       ${where}
       ORDER BY p.updated_at DESC
       LIMIT $${limitProfilesPos}
     ),
     ranked_reports AS (
       SELECT
         sp.id AS person_id,
         sp.external_key,
         sp.full_name,
         r.id AS report_id,
         r.bureau,
         r.report_date,
         r.created_at,
         ROW_NUMBER() OVER (
           PARTITION BY sp.id
           ORDER BY r.report_date DESC, r.created_at DESC
         ) AS rn
       FROM selected_people sp
       JOIN credit_reports r ON r.person_id = sp.id
     )
     SELECT person_id, external_key, full_name, report_id, bureau, report_date
     FROM ranked_reports
     WHERE CASE WHEN $${perPersonPos} > 0 THEN rn <= $${perPersonPos} ELSE TRUE END
     ORDER BY external_key, report_date DESC, created_at DESC`,
    params
  );
  if (LATEST_ONLY) {
    const byPerson = new Map();
    for (const row of rows) {
      if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, row);
    }
    return Array.from(byPerson.values());
  }
  return rows;
}

async function loadOpenIssues(reportId) {
  const { rows } = await pg.query(
    `SELECT i.*, r.bureau
     FROM credit_issues i
     LEFT JOIN credit_reports r ON r.id = i.report_id
     WHERE i.report_id = $1
       AND i.status = 'open'
     ORDER BY CASE i.severity WHEN 'blocker' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END, i.created_at DESC`,
    [reportId]
  );
  return rows;
}

async function itemCount(reportId) {
  const { rows } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM credit_items WHERE report_id = $1`,
    [reportId]
  );
  return Number(rows[0]?.n || 0);
}

async function ensureParsedItems(profile) {
  const existing = await itemCount(profile.report_id);
  if (existing > 0) {
    return { parsed: false, inserted: 0, existing };
  }

  const { rows } = await pg.query(
    `SELECT raw_text FROM credit_reports WHERE id = $1`,
    [profile.report_id]
  );
  const raw = String(rows[0]?.raw_text || "");
  if (!raw.trim()) {
    return { parsed: false, inserted: 0, existing: 0, skipped: "no_raw_text" };
  }

  const parsed = parseCreditReportText(raw, profile.bureau);
  await pg.query(`DELETE FROM credit_items WHERE report_id = $1`, [profile.report_id]);
  const inserted = await insertItems(profile.person_id, profile.report_id, profile.bureau, parsed.items || []);
  return { parsed: true, inserted, existing: 0, stats: parsed.stats };
}

async function runProfile(profile) {
  let evidenceSync = { scanned: 0, attached: 0, refreshed: 0 };
  if (!DRY_RUN && EVIDENCE_ROOT) {
    const folder = `${EVIDENCE_ROOT}/${profile.external_key}`;
    const ev = await ingestFolderForPerson(profile.person_id, folder);
    const refreshed = await refreshOpenIssuesForPerson(profile.person_id);
    evidenceSync = { scanned: ev.scanned, attached: ev.attached, refreshed: refreshed.updated };
  }

  const parseResult = await ensureParsedItems(profile);
  const detect = DRY_RUN
    ? await detectIssuesPreviewForReport(profile.report_id)
    : await detectIssuesForReport(profile.report_id, { clearExisting: true });
  if (!DRY_RUN && EVIDENCE_ROOT) {
    await refreshOpenIssuesForPerson(profile.person_id);
  }
  const issues = orderIssues(await loadOpenIssues(profile.report_id));
  let actionsAllowed = 0;
  let actionsBlocked = 0;
  let lettersDrafted = 0;
  let lettersExisting = 0;

  if (!DRY_RUN) {
    for (const issue of issues) {
      const res = await createActionForIssue(issue, {
        evidenceTags: issue.evidence_present || [],
        monthlyBudget: MONTHLY_BUDGET,
      });
      if (res.policy_allowed) {
        actionsAllowed += 1;
        if (DRAFT_LETTERS && !res.reused && ["bureau_dispute", "furnisher_dispute", "debt_validation", "goodwill_request", "cfpb_escalation"].includes(res.action_type)) {
          const draftRes = await ensureDraftForAction(pg, res.id, { saveCorrespondence: true });
          if (draftRes.drafted) lettersDrafted += 1;
          else lettersExisting += 1;
        }
      } else {
        actionsBlocked += 1;
      }
    }
  }

  return {
    person_key: profile.external_key,
    report_id: profile.report_id,
    bureau: profile.bureau,
    report_date: profile.report_date,
    parsed_now: parseResult.parsed,
    parsed_inserted_items: parseResult.inserted,
    existing_items_before_parse: parseResult.existing || 0,
    parse_skipped_reason: parseResult.skipped || null,
    evidence_scanned: evidenceSync.scanned,
    evidence_attached: evidenceSync.attached,
    evidence_refreshed_issues: evidenceSync.refreshed,
    scanned_items: detect.scanned_items,
    detected_issues: detect.issues_detected,
    open_issues: issues.length,
    actions_allowed: actionsAllowed,
    actions_blocked: actionsBlocked,
    letters_drafted: lettersDrafted,
    letters_existing: lettersExisting,
  };
}

async function main() {
  const start = new Date();
  console.log(`[credit-autopilot] start ${start.toISOString()} dry_run=${DRY_RUN} monthly_budget=${MONTHLY_BUDGET} draft_letters=${DRAFT_LETTERS}`);
  const reconciled = await reconcileStaleArtifacts();
  if ((reconciled.actions_closed || 0) > 0 || (reconciled.deadlines_closed || 0) > 0) {
    console.log(`[credit-autopilot] reconciled stale artifacts actions=${reconciled.actions_closed} deadlines=${reconciled.deadlines_closed}`);
  }
  const reports = await targetReports(LIMIT_PROFILES);
  console.log(`[credit-autopilot] target_reports=${reports.length} latest_only=${LATEST_ONLY} max_reports_per_person=${MAX_REPORTS_PER_PERSON}`);

  const summary = [];
  for (const p of reports) {
    try {
      const res = await runProfile(p);
      summary.push(res);
      console.log(`[credit-autopilot] ${res.person_key} issues=${res.open_issues} allowed=${res.actions_allowed} blocked=${res.actions_blocked} drafted=${res.letters_drafted} existing=${res.letters_existing}`);
    } catch (err) {
      console.error(`[credit-autopilot] ${p.external_key} failed: ${err.message}`);
    }
  }

  let queued = { due_rows: 0, tasks_queued: 0 };
  if (!DRY_RUN) {
    queued = await queueDueEchoTasks({ limit: LIMIT_DEADLINES });
  }

  const end = new Date();
  const agg = summary.reduce(
    (a, x) => {
      a.detected_issues += x.detected_issues;
      a.open_issues += x.open_issues;
      a.actions_allowed += x.actions_allowed;
      a.actions_blocked += x.actions_blocked;
      a.letters_drafted += x.letters_drafted;
      a.letters_existing += x.letters_existing;
      return a;
    },
    { detected_issues: 0, open_issues: 0, actions_allowed: 0, actions_blocked: 0, letters_drafted: 0, letters_existing: 0 }
  );

  console.log(`[credit-autopilot] done ${end.toISOString()}`);
  console.log(
    `[credit-autopilot] profiles=${summary.length} detected=${agg.detected_issues} open=${agg.open_issues} ` +
    `allowed=${agg.actions_allowed} blocked=${agg.actions_blocked} drafted=${agg.letters_drafted} existing=${agg.letters_existing} deadline_echo_queued=${queued.tasks_queued}`
  );
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("[credit-autopilot] fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { detectIssuesForReport, reconcileStaleArtifacts } = require("../control/credit/rules");
const { createActionForIssue } = require("../control/credit/workflow");
const { orderIssues, phaseForIssue } = require("../control/credit/prioritizer");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const reportId = getArg("--report-id");
const personKey = getArg("--person-key");
const CREATE_ACTIONS = hasFlag("--create-actions");
const CLEAR = !hasFlag("--no-clear");

async function resolveReportId() {
  if (reportId) return reportId;
  if (!personKey) throw new Error("Provide --report-id or --person-key");

  const { rows } = await pg.query(
    `SELECT r.id
     FROM credit_reports r
     JOIN credit_person_profiles p ON p.id = r.person_id
     WHERE p.external_key = $1
     ORDER BY r.report_date DESC, r.created_at DESC
     LIMIT 1`,
    [personKey]
  );
  if (!rows[0]) throw new Error(`No credit report found for person_key=${personKey}`);
  return rows[0].id;
}

async function loadOpenIssues(rid) {
  const { rows } = await pg.query(
    `SELECT i.id, i.person_id, i.report_id, i.item_id, i.issue_type, i.severity, i.status, i.title, i.details,
            i.confidence, i.recommended_workflow, i.evidence_required, i.evidence_present, r.bureau
     FROM credit_issues i
     LEFT JOIN credit_reports r ON r.id = i.report_id
     WHERE i.report_id = $1 AND i.status = 'open'
     ORDER BY CASE i.severity WHEN 'blocker' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END, i.created_at DESC`,
    [rid]
  );
  return rows;
}

async function main() {
  await reconcileStaleArtifacts();
  const rid = await resolveReportId();
  const detection = await detectIssuesForReport(rid, { clearExisting: CLEAR });
  const issues = orderIssues(await loadOpenIssues(rid));

  console.log("\n=== Credit Analysis ===\n");
  console.log(`report_id:       ${rid}`);
  console.log(`items_scanned:   ${detection.scanned_items}`);
  console.log(`issues_detected: ${detection.issues_detected}`);
  console.log("");
  for (const i of issues) {
    console.log(`- [phase ${phaseForIssue(i.issue_type)}][${i.severity}] ${i.issue_type} | ${i.title}`);
    if (i.details) console.log(`  details: ${i.details}`);
    console.log(`  workflow: ${i.recommended_workflow} | confidence: ${Math.round(Number(i.confidence || 0) * 100)}%`);
  }

  if (!CREATE_ACTIONS) return;

  let queued = 0;
  let blocked = 0;
  for (const i of issues) {
    const action = await createActionForIssue(i, { evidenceTags: i.evidence_present || [] });
    if (action.policy_allowed) queued += 1;
    else blocked += 1;
  }

  console.log("");
  console.log(`actions_created: ${issues.length}`);
  console.log(`policy_allowed:  ${queued}`);
  console.log(`policy_blocked:  ${blocked}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

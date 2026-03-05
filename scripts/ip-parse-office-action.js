#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { parseOfficeAction } = require("../control/ip/office-action");
const { getRules, detectIssuesByRules, buildDeadlineByRules } = require("../control/ip/rules-engine");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const DOC_ID = getArg("--doc-id", null);
const CASE_ID = getArg("--case-id", null);
const LIMIT = Math.max(1, Number(getArg("--limit", "50")) || 50);

async function parseDoc(doc) {
  const parsed = parseOfficeAction(doc.extracted_text || "");
  const { rules, version: ruleSetVersion } = await getRules();
  const detected = detectIssuesByRules(doc.extracted_text || "", rules);
  const mergedIssues = new Map();
  for (const i of parsed.issues || []) mergedIssues.set(i.issue_type, i);
  for (const i of detected) {
    if (!mergedIssues.has(i.issue_type)) {
      mergedIssues.set(i.issue_type, {
        issue_type: i.issue_type,
        severity: i.severity,
        extracted_text_snippet: null,
        recommended_actions: [],
      });
    }
  }
  parsed.issues = [...mergedIssues.values()];
  const detDeadline = buildDeadlineByRules(parsed.office_action_type === "final" ? "final" : "nonfinal", parsed.issue_date, rules);
  if (detDeadline) parsed.deadlines = [detDeadline];
  if (!parsed.office_action_type && parsed.issues.length === 0) return false;

  const ev = await pg.query(
    `INSERT INTO ip_events (case_id, doc_id, event_type, event_date, summary, metadata_json, rule_set_version)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING id`,
    [
      doc.case_id,
      doc.id,
      parsed.office_action_type === "final" ? "office_action_final" : "office_action_nonfinal",
      parsed.issue_date,
      `Parsed office action (${parsed.office_action_type || "unknown"})`,
      JSON.stringify(parsed),
      ruleSetVersion || null,
    ]
  );

  const eventId = ev.rows[0].id;

  for (const issue of parsed.issues) {
    await pg.query(
      `INSERT INTO ip_issues
        (case_id, event_id, detected_from_doc_id, issue_type, severity, extracted_text_snippet, recommended_actions_json, rule_set_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [doc.case_id, eventId, doc.id, issue.issue_type, issue.severity, issue.extracted_text_snippet || null, JSON.stringify(issue.recommended_actions || []), ruleSetVersion || null]
    );
  }

  for (const d of parsed.deadlines) {
    await pg.query(
      `INSERT INTO ip_deadlines (case_id, trigger_event_id, deadline_type, due_date, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [doc.case_id, eventId, d.deadline_type, d.due_date, d.source, d.notes || null]
    );
  }

  return true;
}

async function main() {
  const where = [];
  const params = [];

  if (DOC_ID) {
    params.push(DOC_ID);
    where.push(`d.id = $${params.length}`);
  }
  if (CASE_ID) {
    params.push(CASE_ID);
    where.push(`d.case_id = $${params.length}`);
  }

  params.push(LIMIT);

  const q = `
    SELECT d.id, d.case_id, d.title, d.extracted_text
    FROM ip_documents d
    WHERE ${where.length ? where.join(" AND ") : "d.doc_type = 'office_action'"}
    ORDER BY d.created_at DESC
    LIMIT $${params.length}`;

  const { rows } = await pg.query(q, params);
  let parsedCount = 0;

  for (const doc of rows) {
    const ok = await parseDoc(doc);
    if (ok) parsedCount += 1;
  }

  console.log(`[ip-parse-office-action] scanned=${rows.length} parsed=${parsedCount}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

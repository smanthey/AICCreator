"use strict";

const { v4: uuidv4 } = require("uuid");
const pg = require("../../infra/postgres");
const { evaluateCreditAction, DISPUTE_CADENCE_WINDOW_DAYS } = require("./policy");
const { phaseForIssue } = require("./prioritizer");
const { buildUtilizationPlan } = require("./optimizer");

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function actionForIssue(issueType) {
  switch (issueType) {
    case "duplicate_collection":
    case "collection_validation_needed":
      return { action_type: "debt_validation", channel: "collector", response_days: 30 };
    case "duplicate_tradeline":
    case "balance_mismatch":
    case "date_inconsistency":
    case "mixed_file_indicator":
    case "unauthorized_inquiry":
    case "collection_status_validation":
      return { action_type: "bureau_dispute", channel: "bureau", response_days: 30 };
    case "transfer_validation_needed":
      return { action_type: "furnisher_dispute", channel: "furnisher", response_days: 30 };
    case "high_utilization":
      return { action_type: "utilization_tuneup", channel: "internal", response_days: 7 };
    default:
      return { action_type: "manual_review", channel: "internal", response_days: 14 };
  }
}

async function createActionForIssue(issue, opts = {}) {
  const mapping = actionForIssue(issue.issue_type);
  const existing = await pg.query(
    `SELECT id, status, action_type, channel, response_due_date
     FROM credit_actions
     WHERE issue_id = $1 AND action_type = $2
       AND status IN ('draft', 'queued', 'sent', 'blocked')
     ORDER BY created_at DESC
     LIMIT 1`,
    [issue.id, mapping.action_type]
  );
  if (existing.rows[0]) {
    return {
      ...existing.rows[0],
      policy_allowed: existing.rows[0].status !== "blocked",
      policy_reason: "existing_action_reused",
      reused: true,
    };
  }

  const existingByIssueType = await pg.query(
    `SELECT id, status, action_type, channel, response_due_date
     FROM credit_actions
     WHERE person_id = $1
       AND action_type = $2
       AND (payload_json->>'issue_type') = $3
       AND status IN ('draft', 'queued', 'sent', 'blocked')
       AND created_at >= NOW() - INTERVAL '45 days'
     ORDER BY created_at DESC
     LIMIT 1`,
    [issue.person_id, mapping.action_type, issue.issue_type]
  );
  if (existingByIssueType.rows[0]) {
    return {
      ...existingByIssueType.rows[0],
      policy_allowed: existingByIssueType.rows[0].status !== "blocked",
      policy_reason: "existing_issue_type_action_reused",
      reused: true,
    };
  }

  const evidenceTags = opts.evidenceTags || issue.evidence_present || [];
  let recentBureauDisputes = 0;
  if (mapping.action_type === "bureau_dispute") {
    const { rows } = await pg.query(
      `SELECT COUNT(*)::int AS n
       FROM credit_actions
       WHERE person_id = $1
         AND action_type = 'bureau_dispute'
         AND status IN ('queued', 'sent')
         AND created_at >= NOW() - ($2::text || ' days')::interval`,
      [issue.person_id, String(DISPUTE_CADENCE_WINDOW_DAYS)]
    );
    recentBureauDisputes = Number(rows[0]?.n || 0);
  }
  const decision = await evaluateCreditAction({
    actionType: mapping.action_type,
    issueType: issue.issue_type,
    evidenceTags,
    assertedNotMine: Boolean(opts.assertedNotMine),
    recentBureauDisputes,
  });

  const status = decision.allowed ? "queued" : "blocked";
  const responseDueDate = todayPlus(mapping.response_days);

  let phase2Payload = {};
  if (issue.issue_type === "high_utilization" && issue.report_id) {
    const utilPlan = await buildUtilizationPlan(issue.report_id, { monthlyBudget: Number(opts.monthlyBudget || 0) });
    const line = utilPlan.lines.find((x) => x.account_id === issue.item_id) || null;
    phase2Payload = {
      phase2_utilization: {
        per_card_target: utilPlan.per_card_target,
        account: line,
        summary: utilPlan.summary,
      },
    };
  }

  const { rows } = await pg.query(
    `INSERT INTO credit_actions
       (person_id, issue_id, action_type, channel, status, recipient, payload_json, policy_decision_id, response_due_date)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING id, status, action_type, channel, response_due_date`,
    [
      issue.person_id,
      issue.id,
      mapping.action_type,
      mapping.channel,
      status,
      issue.bureau || null,
      JSON.stringify({
        issue_type: issue.issue_type,
        phase: phaseForIssue(issue.issue_type),
        priority_impact: Number(issue.score_impact_estimate || 0),
        priority_confidence: Number(issue.confidence || 0),
        issue_title: issue.title,
        recommended_workflow: issue.recommended_workflow,
        evidence_required: issue.evidence_required || [],
        ...phase2Payload,
      }),
      decision.decision_id,
      responseDueDate,
    ]
  );
  const action = rows[0];

  await pg.query(
    `INSERT INTO credit_deadlines
       (person_id, issue_id, action_id, deadline_type, due_date, status, notes, metadata_json)
     VALUES
       ($1,$2,$3,$4,$5,'open',$6,$7::jsonb)`,
    [
      issue.person_id,
      issue.id,
      action.id,
      `${mapping.action_type}_response_check`,
      responseDueDate,
      decision.allowed ? "Follow up on response / verification window." : `Blocked by policy: ${decision.reason}`,
      JSON.stringify({ policy_allowed: decision.allowed }),
    ]
  );

  if (!decision.allowed) {
    await pg.query(
      `UPDATE credit_issues SET status = 'in_review' WHERE id = $1 AND status = 'open'`,
      [issue.id]
    );
  }

  return {
    ...action,
    policy_allowed: decision.allowed,
    policy_reason: decision.reason,
  };
}

async function queueDueEchoTasks({ personId = null, limit = 25 } = {}) {
  const filters = [];
  const params = [];
  if (personId) {
    params.push(personId);
    filters.push(`d.person_id = $${params.length}`);
  }
  params.push(limit);
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

  const { rows } = await pg.query(
    `SELECT d.id, d.person_id, d.deadline_type, d.due_date, d.notes,
            i.issue_type, i.title
     FROM credit_deadlines d
     LEFT JOIN credit_issues i ON i.id = d.issue_id
     WHERE d.status = 'open'
       AND d.due_date <= CURRENT_DATE
       ${where}
     ORDER BY d.due_date ASC
     LIMIT $${params.length}`,
    params
  );

  let queued = 0;
  for (const row of rows) {
    const id = uuidv4();
    const payload = {
      kind: "credit_deadline_reminder",
      deadline_id: row.id,
      person_id: row.person_id,
      issue_type: row.issue_type,
      due_date: row.due_date,
      note: row.notes,
      title: row.title,
    };
    await pg.query(
      `INSERT INTO tasks (id, type, payload, status, priority, title)
       VALUES ($1,'echo',$2::jsonb,'CREATED',2,$3)`,
      [id, JSON.stringify(payload), `credit:${row.deadline_type}:${row.due_date}`]
    );
    queued += 1;
  }

  return { due_rows: rows.length, tasks_queued: queued };
}

module.exports = {
  createActionForIssue,
  queueDueEchoTasks,
};

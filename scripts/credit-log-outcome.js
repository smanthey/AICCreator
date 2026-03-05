#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const ACTION_ID = getArg("--action-id");
const RESULT = getArg("--result", "pending");
const SCORE_DELTA = Number(getArg("--score-delta", "0")) || 0;
const BUREAU = getArg("--bureau", null);
const RESPONSE_JSON = getArg("--response-json", "{}");
const UPDATED_FIELDS_JSON = getArg("--updated-fields-json", "{}");

function winFromResult(result) {
  return ["won", "partially_won"].includes(String(result || "").toLowerCase());
}

function severityToInt(v) {
  const n = Number(v);
  if (Number.isFinite(n)) return Math.trunc(n);
  const s = String(v || "").toLowerCase();
  if (s === "blocker") return 90;
  if (s === "warn") return 60;
  if (s === "info") return 30;
  return 0;
}

async function main() {
  if (!ACTION_ID) {
    throw new Error("Usage: node scripts/credit-log-outcome.js --action-id <uuid> --result won|partially_won|lost|no_change|pending [--score-delta 0]");
  }

  const { rows } = await pg.query(
    `SELECT a.id, a.person_id, a.issue_id, a.action_type, i.issue_type, i.severity, i.confidence,
            COALESCE(r.bureau, i.metadata_json->>'bureau') AS bureau
     FROM credit_actions a
     LEFT JOIN credit_issues i ON i.id = a.issue_id
     LEFT JOIN credit_reports r ON r.id = i.report_id
     WHERE a.id = $1
     LIMIT 1`,
    [ACTION_ID]
  );
  const action = rows[0];
  if (!action) throw new Error(`action_not_found:${ACTION_ID}`);

  const bureau = BUREAU || action.bureau || null;
  const responseJson = JSON.parse(RESPONSE_JSON);
  const updatedFields = JSON.parse(UPDATED_FIELDS_JSON);
  const win = winFromResult(RESULT);

  await pg.query(
    `INSERT INTO credit_action_outcomes
       (action_id, issue_id, person_id, bureau, bureau_response, result, score_delta, updated_fields)
     VALUES
       ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)`,
    [
      ACTION_ID,
      action.issue_id || null,
      action.person_id,
      bureau,
      JSON.stringify(responseJson),
      RESULT,
      SCORE_DELTA,
      JSON.stringify(updatedFields),
    ]
  );

  await pg.query(
    `INSERT INTO credit_learning_events
       (issue_type, action_type, bureau, win, severity, win_prob, score_delta, metadata_json)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      action.issue_type || "unknown_issue",
      action.action_type,
      bureau,
      win,
      severityToInt(action.severity),
      Number(action.confidence || 0),
      SCORE_DELTA,
      JSON.stringify({
        action_id: ACTION_ID,
        issue_id: action.issue_id,
        result: RESULT,
      }),
    ]
  );

  await pg.query(
    `UPDATE credit_actions
     SET status = CASE WHEN $2 IN ('pending') THEN status ELSE 'completed' END,
         completed_at = CASE WHEN $2 IN ('pending') THEN completed_at ELSE NOW() END,
         result_json = COALESCE(result_json, '{}'::jsonb) || jsonb_build_object('result', $2::text, 'score_delta', $3::int),
         updated_at = NOW()
     WHERE id = $1`,
    [ACTION_ID, RESULT, SCORE_DELTA]
  );

  if (action.issue_id && RESULT !== "pending") {
    await pg.query(
      `UPDATE credit_issues
       SET status = CASE
         WHEN $2 IN ('won', 'partially_won') THEN 'resolved'
         WHEN $2 IN ('lost', 'no_change') THEN 'in_review'
         ELSE status
       END,
       updated_at = NOW()
       WHERE id = $1`,
      [action.issue_id, RESULT]
    );
  }

  console.log("\n=== Credit Outcome Logged ===\n");
  console.log(`action_id: ${ACTION_ID}`);
  console.log(`result: ${RESULT}`);
  console.log(`win: ${win}`);
  console.log(`score_delta: ${SCORE_DELTA}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });

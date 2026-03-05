#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { getGmail } = require("../infra/gmail-client");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const LIMIT = Math.max(1, Number(getArg("--limit", "50")) || 50);
const DRY_RUN = hasFlag("--dry-run");
const AUTO_LOG_OUTCOME = hasFlag("--auto-log-outcome");
const OUTCOME_RESULT = getArg("--outcome-result", "partially_won");
const OUTCOME_SCORE_DELTA = Number(getArg("--outcome-score-delta", "5")) || 0;

async function loadSentActions(limit) {
  const { rows } = await pg.query(
    `SELECT a.id, a.person_id, a.issue_id, a.action_type, a.sent_at,
            COALESCE(a.result_json->>'gmail_api_message_id','') AS gmail_api_message_id,
            COALESCE(a.result_json->>'gmail_thread_id','') AS gmail_thread_id,
            COALESCE(a.result_json->>'rfc822_message_id','') AS rfc822_message_id
     FROM credit_actions a
     WHERE a.status = 'sent'
       AND a.sent_at >= NOW() - INTERVAL '60 days'
     ORDER BY a.sent_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

function parseSubject(headers) {
  const h = headers.find((x) => String(x.name || "").toLowerCase() === "subject");
  return h?.value || "";
}

async function main() {
  const rows = await loadSentActions(LIMIT);
  if (!rows.length) {
    console.log("No sent credit actions to check.");
    return;
  }

  const gmail = !DRY_RUN ? getGmail() : null;
  let responses = 0;

  for (const row of rows) {
    const hasThread = Boolean(row.gmail_thread_id);
    const hasRfcId = Boolean(row.rfc822_message_id);
    const query = hasRfcId ? `rfc822msgid:${row.rfc822_message_id}` : `"${row.id}" newer_than:60d`;

    if (DRY_RUN) {
      console.log(`[credit-sync-replies] dry-run action=${row.id} thread=${row.gmail_thread_id || "(none)"} query="${query}"`);
      continue;
    }

    let ids = [];
    if (hasThread) {
      const t = await gmail.users.threads.get({
        userId: "me",
        id: row.gmail_thread_id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date", "X-Claw-Credit-Action-Id", "Message-ID"],
      });
      ids = (t?.data?.messages || []).map((m) => ({ id: m.id }));
    } else {
      const list = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 10,
      });
      ids = list?.data?.messages || [];
    }
    if (!ids.length) continue;

    let replyHit = null;
    for (const m of ids) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date", "In-Reply-To", "References", "X-Claw-Credit-Action-Id"],
      });
      const headers = msg?.data?.payload?.headers || [];
      const subject = parseSubject(headers);
      const fromHeader = headers.find((x) => String(x.name || "").toLowerCase() === "from")?.value || "";
      const actionHeader = headers.find((x) => String(x.name || "").toLowerCase() === "x-claw-credit-action-id")?.value || "";
      const internalDomainRegex = new RegExp(
        process.env.CREDIT_SYNC_INTERNAL_DOMAIN_REGEX ||
          "creator@example\\\\.com|example\\\\.internal",
        "i"
      );
      const fromLooksExternal = !internalDomainRegex.test(fromHeader);
      if (
        fromLooksExternal &&
        (
          actionHeader === String(row.id) ||
          (subject && subject.toLowerCase().includes(String(row.id).toLowerCase()))
        )
      ) {
        replyHit = { gmail_id: m.id, subject };
        break;
      }
    }
    if (!replyHit) continue;

    await pg.query(
      `UPDATE credit_actions
       SET status='completed',
           completed_at=NOW(),
           updated_at=NOW(),
           result_json = result_json || $2::jsonb
       WHERE id = $1`,
      [row.id, JSON.stringify({ reply_detected: true, reply_gmail_id: replyHit.gmail_id, reply_subject: replyHit.subject })]
    );
    await pg.query(
      `UPDATE credit_deadlines
       SET status='done',
           notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE ' ' END || '[reply detected]',
           updated_at = NOW()
       WHERE action_id = $1
         AND status = 'open'`,
      [row.id]
    );
    responses += 1;

    if (AUTO_LOG_OUTCOME) {
      await pg.query(
        `INSERT INTO credit_action_outcomes
           (action_id, issue_id, person_id, bureau, bureau_response, result, score_delta, updated_fields)
         VALUES
           ($1,$2,$3,NULL,$4::jsonb,$5,$6,$7::jsonb)`,
        [
          row.id,
          row.issue_id || null,
          row.person_id,
          JSON.stringify({ source: "gmail_reply", gmail_id: replyHit.gmail_id, subject: replyHit.subject }),
          OUTCOME_RESULT,
          OUTCOME_SCORE_DELTA,
          JSON.stringify({ reply_detected: true }),
        ]
      );
      await pg.query(
        `INSERT INTO credit_learning_events
           (issue_type, action_type, bureau, win, severity, win_prob, score_delta, metadata_json)
         SELECT
           COALESCE(i.issue_type, 'unknown_issue'),
           $2,
           COALESCE(r.bureau, i.metadata_json->>'bureau'),
           CASE WHEN $3 IN ('won','partially_won') THEN true ELSE false END,
           CASE WHEN i.severity='blocker' THEN 90 WHEN i.severity='warn' THEN 60 WHEN i.severity='info' THEN 30 ELSE 0 END,
           COALESCE(i.confidence, 0),
           $4,
           jsonb_build_object('action_id',$1,'source','credit-sync-replies')
         FROM credit_actions a
         LEFT JOIN credit_issues i ON i.id = a.issue_id
         LEFT JOIN credit_reports r ON r.id = i.report_id
         WHERE a.id = $1`,
        [row.id, row.action_type, OUTCOME_RESULT, OUTCOME_SCORE_DELTA]
      );
    }
  }

  console.log("\n=== Credit Sync Replies ===\n");
  console.log(`checked: ${rows.length}`);
  console.log(`responses_detected: ${responses}`);
  console.log(`auto_log_outcome: ${AUTO_LOG_OUTCOME ? "yes" : "no"}`);
  console.log(`dry_run: ${DRY_RUN ? "yes" : "no"}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

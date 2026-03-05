#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { getGmail, buildRawMessage } = require("../infra/gmail-client");
const { getRecipient } = require("../control/credit/recipients");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const LIMIT = Math.max(1, Number(getArg("--limit", "20")) || 20);
const DRY_RUN = hasFlag("--dry-run");
const FOR_CHANNEL = getArg("--channel", "bureau");
const FROM_EMAIL = process.env.CREDIT_GMAIL_FROM || process.env.MAILEROO_FROM_EMAIL || "";

async function resolveFromEmail(gmail, dryRun) {
  if (FROM_EMAIL) return FROM_EMAIL;
  if (dryRun || !gmail) return "";
  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = String(profile?.data?.emailAddress || "").trim();
    return email;
  } catch {
    return "";
  }
}

function recipientForAction(action) {
  return getRecipient(action.action_type, {
    bureau: action.bureau,
    furnisher_name: action.furnisher_name,
  });
}

async function loadQueuedActions(limit, channel) {
  const { rows } = await pg.query(
    `SELECT a.id AS action_id, a.person_id, a.issue_id, a.action_type, a.channel, a.status,
            p.external_key, p.full_name,
            i.evidence_required, i.evidence_present,
            r.bureau,
            it.furnisher_name,
            l.id AS letter_id, l.subject, l.body_text
     FROM credit_actions a
     JOIN credit_person_profiles p ON p.id = a.person_id
     LEFT JOIN credit_issues i ON i.id = a.issue_id
     LEFT JOIN credit_reports r ON r.id = i.report_id
     LEFT JOIN credit_items it ON it.id = i.item_id
     LEFT JOIN LATERAL (
       SELECT id, subject, body_text
       FROM credit_letters
       WHERE action_id = a.id
       ORDER BY version DESC, created_at DESC
       LIMIT 1
     ) l ON TRUE
     WHERE a.status IN ('queued','draft')
       AND a.channel = $1
     ORDER BY a.created_at ASC
     LIMIT $2`,
    [channel, limit]
  );
  return rows;
}

async function main() {
  const actions = await loadQueuedActions(LIMIT, FOR_CHANNEL);
  const gmail = !DRY_RUN ? getGmail() : null;
  const fromEmail = await resolveFromEmail(gmail, DRY_RUN);
  if (!fromEmail && !DRY_RUN) throw new Error("missing_sender_email:CREDIT_GMAIL_FROM_or_oauth_profile");

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of actions) {
    const evidenceRequired = Boolean(row.evidence_required);
    const evidencePresent = Array.isArray(row.evidence_present) ? row.evidence_present : [];
    if (evidenceRequired && evidencePresent.length === 0) {
      skipped += 1;
      if (!DRY_RUN) {
        await pg.query(
          `UPDATE credit_actions
           SET status='blocked',
               updated_at=NOW(),
               result_json = COALESCE(result_json,'{}'::jsonb) || $2::jsonb
           WHERE id = $1`,
          [row.action_id, JSON.stringify({ blocked_reason: "evidence_required_missing", blocked_at: new Date().toISOString() })]
        );
      }
      continue;
    }

    const to = recipientForAction(row);
    if (!to) {
      skipped += 1;
      continue;
    }
    const subject = row.subject || `[credit-action:${row.action_id}] ${row.action_type} (${row.external_key})`;
    const bodyText = row.body_text || `Credit action ${row.action_id} has no generated body.`;

    if (DRY_RUN) {
      console.log(`[credit-send-queued] dry-run action=${row.action_id} to=${to}`);
      sent += 1;
      continue;
    }

    try {
      const raw = buildRawMessage({
        from: fromEmail,
        to,
        subject,
        text: `${bodyText}\n\n[action_id:${row.action_id}]`,
        html: `<pre>${String(bodyText).replace(/[<>&]/g, " ")}</pre><p>[action_id:${row.action_id}]</p>`,
        actionId: row.action_id,
      });
      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
      const apiMessageId = res?.data?.id || null;
      const threadId = res?.data?.threadId || null;
      let internetMessageId = null;
      if (apiMessageId) {
        try {
          const meta = await gmail.users.messages.get({
            userId: "me",
            id: apiMessageId,
            format: "metadata",
            metadataHeaders: ["Message-ID"],
          });
          const headers = meta?.data?.payload?.headers || [];
          const h = headers.find((x) => String(x.name || "").toLowerCase() === "message-id");
          internetMessageId = h?.value || null;
        } catch {
          internetMessageId = null;
        }
      }

      await pg.query(
        `UPDATE credit_actions
         SET status='sent', sent_at=NOW(), updated_at=NOW(),
             result_json = result_json || $2::jsonb
         WHERE id = $1`,
        [row.action_id, JSON.stringify({
          gmail_api_message_id: apiMessageId,
          gmail_thread_id: threadId,
          rfc822_message_id: internetMessageId,
          sent_via: "gmail_api",
        })]
      );
      await pg.query(
        `UPDATE credit_correspondence
         SET sent_at = NOW(),
             tracking_number = COALESCE(tracking_number, $2)
         WHERE action_id = $1
           AND sent_at IS NULL`,
        [row.action_id, internetMessageId || apiMessageId]
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      await pg.query(
        `UPDATE credit_actions
         SET status='blocked',
             updated_at = NOW(),
             result_json = result_json || $2::jsonb
         WHERE id = $1`,
        [row.action_id, JSON.stringify({ send_error: err.message, send_error_at: new Date().toISOString() })]
      );
    }
  }

  console.log("\n=== Credit Send Queued ===\n");
  console.log(`channel: ${FOR_CHANNEL}`);
  console.log(`checked: ${actions.length}`);
  console.log(`sent:    ${sent}`);
  console.log(`skipped: ${skipped}`);
  console.log(`failed:  ${failed}`);
  console.log(`dry_run: ${DRY_RUN ? "yes" : "no"}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

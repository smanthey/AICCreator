"use strict";

const { sendMaileroo } = require("../../infra/send-email");
const { sendTelnyxSms } = require("../../infra/telnyx");

function renderMessage(templateKey, payload) {
  const p = payload || {};
  if (templateKey !== "loyalty_points_update") {
    return {
      subject: "Loyalty update",
      text: "Your loyalty account has been updated.",
      html: "<p>Your loyalty account has been updated.</p>",
    };
  }

  const delta = Number(p.points_delta || 0);
  const sign = delta >= 0 ? "+" : "";
  const tier = String(p.tier || "base");
  const balance = Number(p.points_balance || 0);

  const subject = delta >= 0
    ? `You earned ${delta} loyalty points`
    : `Loyalty points update (${sign}${delta})`;

  const text =
    `Loyalty update: ${sign}${delta} points. ` +
    `Current balance: ${balance}. Tier: ${tier}.`;

  const html =
    `<p><strong>Loyalty update</strong></p>` +
    `<p>Points change: <strong>${sign}${delta}</strong></p>` +
    `<p>Current balance: <strong>${balance}</strong><br/>Tier: <strong>${tier}</strong></p>`;

  return { subject, text, html };
}

async function processOutreachQueue(db, limit = 100) {
  const { rows } = await db.query(
    `SELECT q.id, q.member_id, q.channel, q.template_key, q.payload_json, q.attempts,
            m.email, m.phone, m.wallet_pass_id
     FROM loyalty_outreach_queue q
     JOIN loyalty_members m ON m.id = q.member_id
     WHERE q.status = 'queued'
       AND q.next_attempt_at <= NOW()
     ORDER BY
       CASE
         WHEN COALESCE(q.payload_json->>'wallet_pass_brand', '') = 'cookies' THEN 0
         WHEN COALESCE(q.payload_json->>'wallet_pass_brand', '') = 'nirvana' THEN 1
         ELSE 2
       END,
       q.created_at ASC
     LIMIT $1`,
    [limit]
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of rows) {
    const msg = renderMessage(r.template_key, r.payload_json || {});
    try {
      if (r.channel === "email") {
        if (!r.email) {
          await db.query(
            `UPDATE loyalty_outreach_queue
             SET status='skipped', last_error='missing member email', updated_at=NOW()
             WHERE id=$1`,
            [r.id]
          );
          skipped += 1;
          continue;
        }
        if (!(process.env.LOYALTY_MAILEROO_API_KEY || process.env.MAILEROO_API_KEY) ||
            !(process.env.LOYALTY_FROM_EMAIL || process.env.MAILEROO_FROM_EMAIL)) {
          await db.query(
            `UPDATE loyalty_outreach_queue
             SET status='skipped', last_error='maileroo credentials missing', updated_at=NOW()
             WHERE id=$1`,
            [r.id]
          );
          skipped += 1;
          continue;
        }
        const result = await sendMaileroo({
          to: r.email,
          subject: msg.subject,
          html: msg.html,
          fromName: process.env.LOYALTY_FROM_NAME || process.env.MAILEROO_FROM_NAME || "SkynPatch Loyalty",
          fromEmail: process.env.LOYALTY_FROM_EMAIL || process.env.MAILEROO_FROM_EMAIL,
          apiKey: process.env.LOYALTY_MAILEROO_API_KEY || process.env.MAILEROO_API_KEY,
        });
        if (!(result.status === 200 || result.status === 201)) {
          throw new Error(`maileroo_http_${result.status}`);
        }
      } else if (r.channel === "sms") {
        if (!r.phone) {
          await db.query(
            `UPDATE loyalty_outreach_queue
             SET status='skipped', last_error='missing member phone', updated_at=NOW()
             WHERE id=$1`,
            [r.id]
          );
          skipped += 1;
          continue;
        }
        if (!(process.env.LOYALTY_TELNYX_API_KEY || process.env.TELNYX_API_KEY) ||
            !(process.env.LOYALTY_SMS_FROM || process.env.TELNYX_FROM_NUMBER)) {
          await db.query(
            `UPDATE loyalty_outreach_queue
             SET status='skipped', last_error='telnyx credentials missing', updated_at=NOW()
             WHERE id=$1`,
            [r.id]
          );
          skipped += 1;
          continue;
        }
        const sms = await sendTelnyxSms({
          to: r.phone,
          from: process.env.LOYALTY_SMS_FROM || process.env.TELNYX_FROM_NUMBER,
          text: msg.text,
          apiKey: process.env.LOYALTY_TELNYX_API_KEY || process.env.TELNYX_API_KEY,
        });
        if (!(sms.status === 200 || sms.status === 201 || sms.status === 202)) {
          throw new Error(`telnyx_http_${sms.status}`);
        }
      } else if (r.channel === "wallet_pass") {
        if (!r.wallet_pass_id) {
          await db.query(
            `UPDATE loyalty_outreach_queue
             SET status='skipped', last_error='missing wallet_pass_id', updated_at=NOW()
             WHERE id=$1`,
            [r.id]
          );
          skipped += 1;
          continue;
        }
        // Wallet pass updates are handled via webhook-first flow.
        // We mark as sent for now to keep this deterministic and idempotent.
      } else {
        throw new Error(`unsupported_channel_${r.channel}`);
      }

      await db.query(
        `UPDATE loyalty_outreach_queue
         SET status='sent', sent_at=NOW(), attempts=attempts+1, last_error=NULL, updated_at=NOW()
         WHERE id=$1`,
        [r.id]
      );
      sent += 1;
    } catch (e) {
      await db.query(
        `UPDATE loyalty_outreach_queue
         SET status='failed',
             attempts=attempts+1,
             last_error=$2,
             next_attempt_at=NOW() + INTERVAL '30 minutes',
             updated_at=NOW()
         WHERE id=$1`,
        [r.id, String(e.message || e).slice(0, 500)]
      );
      failed += 1;
    }
  }

  return { queued: rows.length, sent, failed, skipped };
}

module.exports = {
  processOutreachQueue,
};

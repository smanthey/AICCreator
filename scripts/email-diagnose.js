#!/usr/bin/env node
/**
 * email-diagnose.js
 * Sends one test email and prints full request/response for debugging.
 * Use this to verify Maileroo/Resend delivery and check Maileroo dashboard logs.
 *
 * Usage:
 *   node scripts/email-diagnose.js                    # send to shop@skynpatch.com
 *   node scripts/email-diagnose.js --to you@mail.com
 *   node scripts/email-diagnose.js --resend           # force Resend
 *   node scripts/email-diagnose.js --brevo           # force Brevo (300/day free)
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const toEmail = (() => {
  const i = process.argv.indexOf("--to");
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "shop@skynpatch.com";
})();
if (process.argv.includes("--resend") && process.env.RESEND_API_KEY) process.env.EMAIL_PROVIDER = "resend";
if (process.argv.includes("--brevo") && process.env.BREVO_API_KEY) process.env.EMAIL_PROVIDER = "brevo";

async function main() {
  const fromEmail = process.env.MAILEROO_FROM_EMAIL || "shop@skynpatch.com";
  const fromName = process.env.MAILEROO_FROM_NAME || "Scott";
  const subject = `[Diagnostic] Email test ${new Date().toISOString()}`;
  const html = `<p>If you received this, your email pipeline is working.</p><p>Sent at ${new Date().toISOString()}</p>`;

  const { sendEmail, preferredProvider, HAS_RESEND, HAS_MAILEROO, HAS_BREVO } = require("../infra/send-email");
  const provider = preferredProvider();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║          EMAIL DIAGNOSTIC — SEND & VERIFY                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`  To        : ${toEmail}`);
  console.log(`  From      : ${fromName} <${fromEmail}>`);
  console.log(`  RESEND_API_KEY   : ${HAS_RESEND ? "set" : "NOT SET"}`);
  console.log(`  BREVO_API_KEY    : ${HAS_BREVO ? "set" : "NOT SET"} (300/day free)`);
  console.log(`  MAILEROO_API_KEY : ${HAS_MAILEROO ? "set" : "NOT SET"}`);
  console.log(`  Provider  : ${provider}\n`);

  if (!HAS_RESEND && !HAS_MAILEROO && !HAS_BREVO) {
    console.error("  ❌ No API key. Set RESEND_API_KEY, BREVO_API_KEY, or MAILEROO_API_KEY in .env\n");
    process.exit(1);
  }

  try {
    const result = await sendEmail({
      to: toEmail,
      subject,
      html,
      fromName,
      fromEmail,
      apiKey: process.env.MAILEROO_API_KEY,
    });

    console.log("  Response:");
    console.log(`    status: ${result.status}`);
    console.log(`    body: ${JSON.stringify(result.body, null, 2).split("\n").join("\n    ")}\n`);

    if (result.status >= 200 && result.status < 300) {
      const msgId = result.body?.data?.message_id || result.body?.data?.reference_id || result.body?.id || "(none)";
      console.log(`  ✅ API accepted. Message ID: ${msgId}`);
      console.log(`\n  Next steps:`);
      console.log(`  1. Check ${toEmail} (inbox + spam/junk)`);
      if (provider === "maileroo" && HAS_MAILEROO) {
        console.log(`  2. Maileroo Dashboard → Domains → [your domain] → Sending → Logs`);
        console.log(`     (View Events to see delivery status; logs kept 14 days)`);
        console.log(`  3. If Test Mode: max 7 recipients, 100 emails. Verify domain to exit.`);
        console.log(`     https://maileroo.com/help/what-is-test-mode-and-how-can-i-send-emails-without-any-limitations/`);
      }
      if (provider === "brevo") {
        console.log(`  2. Brevo free tier: 300 emails/day. Dashboard: https://app.brevo.com`);
      }
      console.log("");
    } else {
      console.log(`  ❌ Send failed. Check body.message or body.error above.`);
      if (result.body?.message) console.log(`     ${result.body.message}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`  ❌ Error: ${e.message}`);
    process.exit(1);
  }
}

main();

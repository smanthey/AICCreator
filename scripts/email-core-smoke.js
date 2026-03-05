"use strict";

/**
 * scripts/email-core-smoke.js
 *
 * Minimal internal caller for core/email to prove the implementation works.
 *
 * Usage:
 *   node scripts/email-core-smoke.js send
 *
 * Required env:
 *   EMAIL_TEST_TO      — recipient email address
 *   EMAIL_TEST_FROM    — sender email address (must be valid for the active provider)
 *
 * Optional env:
 *   EMAIL_TEST_PROVIDER  — 'resend' | 'maileroo' (overrides infra defaults)
 *   EMAIL_TEST_SUBJECT   — overrides default subject
 */

require("dotenv").config({ override: true });

const { CORE_EMAIL_VERSION, sendEmail } = require("../core/email");

async function main() {
  const [command] = process.argv.slice(2);

  if (!command || command === "help") {
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "core/email v" + CORE_EMAIL_VERSION + " smoke tests",
        "",
        "Commands:",
        "  send   # Send a simple test email using core/email",
        "",
        "Required env:",
        "  EMAIL_TEST_TO      — recipient email address",
        "  EMAIL_TEST_FROM    — sender email address",
        "",
        "Optional env:",
        "  EMAIL_TEST_PROVIDER  — 'resend' | 'maileroo'",
        "  EMAIL_TEST_SUBJECT   — custom subject",
        "",
      ].join("\n")
    );
    process.exit(0);
  }

  if (command === "send") {
    const to = process.env.EMAIL_TEST_TO;
    const fromEmail = process.env.EMAIL_TEST_FROM;

    if (!to || !fromEmail) {
      throw new Error("EMAIL_TEST_TO and EMAIL_TEST_FROM must be set");
    }

    const provider =
      process.env.EMAIL_TEST_PROVIDER && process.env.EMAIL_TEST_PROVIDER.trim()
        ? process.env.EMAIL_TEST_PROVIDER.trim()
        : undefined;

    const subject =
      process.env.EMAIL_TEST_SUBJECT ||
      `OpenClaw core/email smoke test (${new Date().toISOString()})`;

    const result = await sendEmail({
      to,
      fromEmail,
      subject,
      html: "<p>This is a <strong>core/email</strong> smoke test.</p>",
      text: "This is a core/email smoke test.",
      provider,
      brand: "smoke-test",
    });

    // eslint-disable-next-line no-console
    console.log(
      "Email sent:",
      JSON.stringify(
        {
          correlationId: result.correlationId,
          provider: result.provider,
          messageId: result.messageId,
          status: result.status,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Email core smoke test failed:", err && err.message ? err.message : err);
  process.exit(1);
});


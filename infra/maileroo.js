"use strict";

const https = require("https");

/**
 * Send email via Maileroo API v2.
 * Docs: https://maileroo.com/docs/email-api/send-basic-email/
 * - Uses POST https://smtp.maileroo.com/api/v2/emails (JSON).
 * - From address must be a verified domain in your Maileroo account.
 */
function sendMaileroo({ to, subject, html, plain, fromName, fromEmail, apiKey }) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("MAILEROO_API_KEY not set");
  }
  if (!to || !subject) {
    throw new Error("maileroo send requires to + subject");
  }
  if (!html && !plain) {
    throw new Error("maileroo send requires html or plain body");
  }

  const fromEmailTrim = String(fromEmail || "").trim();
  if (!fromEmailTrim) {
    throw new Error("maileroo send requires fromEmail (verified domain in Maileroo)");
  }

  const payload = {
    from: {
      address: fromEmailTrim,
      display_name: fromName ? String(fromName).trim() : undefined,
    },
    to: Array.isArray(to)
      ? to.map((t) => (typeof t === "string" ? { address: t } : { address: t.address, display_name: t.display_name }))
      : [{ address: String(to).trim() }],
    subject: String(subject).slice(0, 255),
    html: html ? String(html) : undefined,
    plain: plain ? String(plain) : undefined,
  };

  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "smtp.maileroo.com",
      path: "/api/v2/emails",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body, "utf8"),
        "X-API-Key": key,
      },
    };

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {}

        // v2 returns { success, message, data: { reference_id } }. Normalize so callers
        // that expect data.message_id or data.reference_id still work; webhooks may use reference_id.
        if (parsed && typeof parsed === "object" && parsed.data && parsed.data.reference_id && !parsed.data.message_id) {
          parsed.data.message_id = parsed.data.reference_id;
        }

        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

module.exports = { sendMaileroo };

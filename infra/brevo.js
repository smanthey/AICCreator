"use strict";

const https = require("https");

/**
 * Send email via Brevo transactional API.
 * Docs: https://developers.brevo.com/reference/sendtransacemail
 */
function sendBrevo({ to, subject, html, plain, fromName, fromEmail, apiKey }) {
  const key = String(apiKey || process.env.BREVO_API_KEY || "").trim();
  if (!key) throw new Error("BREVO_API_KEY not set");
  if (!to || !subject) throw new Error("brevo send requires to + subject");
  if (!html && !plain) throw new Error("brevo send requires html or plain body");

  const senderEmail = String(fromEmail || "").trim();
  if (!senderEmail) throw new Error("brevo send requires fromEmail (verified sender in Brevo)");

  const toList = Array.isArray(to) ? to : [to];
  const payload = {
    sender: {
      email: senderEmail,
      name: fromName ? String(fromName).trim() : senderEmail,
    },
    to: toList.map((t) =>
      typeof t === "string"
        ? { email: String(t).trim() }
        : { email: String(t.email || t.address || "").trim(), name: t.name || t.display_name || undefined }
    ),
    subject: String(subject).slice(0, 255),
    htmlContent: html ? String(html) : undefined,
    textContent: plain ? String(plain) : undefined,
  };

  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body, "utf8"),
        "api-key": key,
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
        if (parsed && typeof parsed === "object" && parsed.messageId && !parsed.data) {
          parsed.data = { message_id: parsed.messageId, id: parsed.messageId };
        }
        resolve({
          status: res.statusCode,
          body: parsed,
          provider: "brevo",
          messageId: parsed?.messageId || parsed?.data?.message_id || parsed?.data?.id || null,
        });
      });
    });

    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

module.exports = { sendBrevo };

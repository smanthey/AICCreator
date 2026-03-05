"use strict";

/**
 * Unified transactional email sender.
 * - Providers: Brevo (preferred), Resend, Maileroo.
 * - Optional per-call provider override: 'brevo' | 'resend' | 'maileroo'.
 * - Fallback chain is enabled when at least two providers are configured.
 */
const https = require("https");

function preferredProvider() {
  const p = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  if (p === "brevo" || p === "resend" || p === "maileroo") return p;
  if (String(process.env.BREVO_API_KEY || "").trim()) return "brevo";
  if (process.env.USE_RESEND === "true" || String(process.env.RESEND_API_KEY || "").trim()) return "resend";
  if (String(process.env.MAILEROO_API_KEY || "").trim()) return "maileroo";
  return "maileroo";
}

async function sendResend({ to, subject, html, plain, fromName, fromEmail }) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) throw new Error("RESEND_API_KEY not set");

  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const toList = Array.isArray(to) ? to : [String(to).trim()];
  const payload = {
    from,
    to: toList,
    subject: String(subject).slice(0, 255),
    html: html || undefined,
    text: plain || undefined,
  };

  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body, "utf8"),
        Authorization: `Bearer ${key}`,
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
        resolve({
          status: res.statusCode,
          body: parsed,
          provider: "resend",
          messageId: parsed?.id || null,
        });
      });
    });
    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

async function sendMailerooInternal({ to, subject, html, plain, fromName, fromEmail, apiKey }) {
  const { sendMaileroo } = require("./maileroo");
  const result = await sendMaileroo({ to, subject, html, plain, fromName, fromEmail, apiKey });

  const body = result.body || {};
  if (result.status >= 200 && result.status < 300 && body.success === false) {
    const msg = body.message || body.error || JSON.stringify(body);
    throw new Error(`Maileroo accepted but did not send: ${msg}`);
  }
  if (result.status >= 400) {
    const msg = body.message || body.error || JSON.stringify(body);
    throw new Error(`Maileroo failed (HTTP ${result.status}): ${msg}`);
  }
  return { ...result, provider: "maileroo", messageId: body?.data?.message_id || body?.data?.reference_id || null };
}

async function sendBrevoInternal({ to, subject, html, plain, fromName, fromEmail, apiKey }) {
  const { sendBrevo } = require("./brevo");
  const result = await sendBrevo({ to, subject, html, plain, fromName, fromEmail, apiKey });
  const body = result.body || {};
  if (result.status >= 400) {
    const msg = body.message || body.code || body.error || JSON.stringify(body);
    throw new Error(`Brevo failed (HTTP ${result.status}): ${msg}`);
  }
  return {
    ...result,
    provider: "brevo",
    messageId: body?.messageId || body?.data?.message_id || body?.id || null,
  };
}

const HAS_BREVO = !!String(process.env.BREVO_API_KEY || "").trim();
const HAS_RESEND = !!String(process.env.RESEND_API_KEY || "").trim();
const HAS_MAILEROO = !!String(process.env.MAILEROO_API_KEY || "").trim();
const USE_BREVO = preferredProvider() === "brevo";
const USE_RESEND = preferredProvider() === "resend";

const PROVIDER_COUNT = [HAS_BREVO, HAS_RESEND, HAS_MAILEROO].filter(Boolean).length;
const FALLBACK_ENABLED = PROVIDER_COUNT >= 2 && process.env.EMAIL_FALLBACK_ENABLED !== "false";

async function sendEmail(opts) {
  const { to, subject, html, plain, fromName, fromEmail, apiKey, provider } = opts;
  const selectedProvider = String(provider || "").trim().toLowerCase() || preferredProvider();

  const tryResend = async () => {
    const res = await sendResend({ to, subject, html, plain, fromName, fromEmail });
    if (res.status >= 400) {
      const msg = res.body?.message || res.body?.error || JSON.stringify(res.body || {}).slice(0, 200);
      throw new Error(`Resend failed (HTTP ${res.status}): ${msg}`);
    }
    return {
      status: res.status,
      body: res.body?.id ? { data: { message_id: res.body.id, id: res.body.id } } : res.body,
      provider: "resend",
      messageId: res.messageId,
    };
  };

  const tryMaileroo = async () =>
    sendMailerooInternal({
      to,
      subject,
      html,
      plain,
      fromName,
      fromEmail,
      apiKey: apiKey || process.env.MAILEROO_API_KEY,
    });

  const tryBrevo = async () =>
    sendBrevoInternal({
      to,
      subject,
      html,
      plain,
      fromName,
      fromEmail,
      apiKey: apiKey || process.env.BREVO_API_KEY,
    });

  const providersInOrder = selectedProvider === "brevo"
    ? ["brevo", "resend", "maileroo"]
    : selectedProvider === "resend"
      ? ["resend", "brevo", "maileroo"]
      : ["maileroo", "brevo", "resend"];

  const providerFns = {
    brevo: tryBrevo,
    resend: tryResend,
    maileroo: tryMaileroo,
  };
  const providerAvailable = {
    brevo: HAS_BREVO || !!apiKey,
    resend: HAS_RESEND,
    maileroo: HAS_MAILEROO || !!apiKey,
  };

  const runnable = providersInOrder.filter((p) => providerAvailable[p]);
  if (!runnable.length) {
    throw new Error("No email provider configured. Set BREVO_API_KEY (preferred), RESEND_API_KEY, or MAILEROO_API_KEY.");
  }

  let lastErr = null;
  for (let i = 0; i < runnable.length; i += 1) {
    const p = runnable[i];
    const canFallback = FALLBACK_ENABLED && i < runnable.length - 1;
    try {
      return await providerFns[p]();
    } catch (err) {
      lastErr = err;
      if (!canFallback) break;
      const next = runnable[i + 1];
      console.warn(`[send-email] Primary (${p}) failed, trying fallback (${next}): ${err.message}`);
    }
  }
  throw lastErr || new Error("sendEmail failed with unknown provider error");
}

async function sendMaileroo(opts) {
  try {
    const res = await sendEmail(opts);
    return { status: res.status, body: res.body };
  } catch (e) {
    return { status: 0, body: { success: false, message: e.message, error: e.message } };
  }
}

module.exports = {
  sendEmail,
  sendMaileroo,
  USE_BREVO,
  USE_RESEND,
  HAS_BREVO,
  HAS_RESEND,
  HAS_MAILEROO,
  FALLBACK_ENABLED,
  preferredProvider,
};

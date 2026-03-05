"use strict";

// Core Email module skeleton for OpenClaw.
// All SaaS repos should use this abstraction instead of calling providers directly.

const path = require("path");
const fs = require("fs/promises");

// Try to delegate retries to core/queue.withRetry when available; otherwise use a
// minimal local exponential backoff implementation (same pattern as core/stripe).
let externalWithRetry = null;
try {
  // eslint-disable-next-line global-require
  const queue = require("./queue");
  if (queue && typeof queue.withRetry === "function") {
    externalWithRetry = queue.withRetry;
  }
} catch {
  // core/queue may not be implemented yet; fallback is used instead.
}

async function runWithRetry(fn, options) {
  if (externalWithRetry) {
    return externalWithRetry(fn, options);
  }

  const maxAttempts = (options && options.maxAttempts) || 4;
  const baseDelayMs = (options && options.baseDelayMs) || 250;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt >= maxAttempts;
      logEmail("warn", "Email send failed", {
        attempt,
        maxAttempts,
        error: err && err.message,
      });
      if (isLast) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
}

// Reuse the infra-level providers so we don't duplicate provider HTTP logic.
const infraSendEmail = require("../infra/send-email");

const CORE_EMAIL_VERSION = "1.0.0";

const ROOT_DIR = path.join(__dirname, "..");
const EMAIL_STATE_DIR = path.join(ROOT_DIR, "agent-state", "email");
const EMAIL_LOG_FILE = path.join(EMAIL_STATE_DIR, "email-events.jsonl");

async function ensureEmailStateDir() {
  await fs.mkdir(EMAIL_STATE_DIR, { recursive: true });
}

async function appendJsonl(filePath, payload) {
  await ensureEmailStateDir();
  // eslint-disable-next-line global-require
  const { atomicAppendJSONL } = require("../control/atomic-state");
  await atomicAppendJSONL(filePath, payload);
}

function logEmail(level, message, context) {
  const base = {
    module: "core/email",
    level,
    message,
    ts: new Date().toISOString(),
    version: CORE_EMAIL_VERSION,
  };
  const payload = context ? { ...base, ...context } : base;
  const logger = typeof console[level] === "function" ? console[level] : console.log;
  logger(JSON.stringify(payload));
}

/**
 * Normalize and send a transactional email.
 *
 * Shape:
 *  {
 *    to: string | string[],
 *    subject: string,
 *    html?: string,
 *    text?: string,
 *    fromName?: string,
 *    fromEmail: string,
 *    provider?: "brevo" | "resend" | "maileroo",
 *    brand?: string,        // optional hint for higher-level routing
 *    correlationId?: string // for logs
 *  }
 *
 * Provider selection:
 *  - If message.provider is set, it wins.
 *  - Otherwise, infra/send-email's USE_RESEND / FALLBACK_ENABLED logic applies
 *    (EMAIL_PROVIDER / BREVO_API_KEY / RESEND_API_KEY / MAILEROO_API_KEY).
 *
 * Retry semantics:
 *  - Delegated to core/queue.withRetry with exponential backoff and jitter.
 */
async function sendEmail(message) {
  if (!message || !message.to || !message.subject || !message.fromEmail) {
    throw new Error("sendEmail requires to, subject, and fromEmail");
  }

  const start = Date.now();
  const correlationId =
    message.correlationId ||
    `email_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  const payloadForInfra = {
    to: message.to,
    subject: message.subject,
    html: message.html || message.htmlBody || undefined,
    plain: message.text || message.textBody || undefined,
    fromName: message.fromName || message.from || undefined,
    fromEmail: message.fromEmail,
    provider: message.provider,
  };

  logEmail("info", "sendEmail_attempt", {
    correlationId,
    to: Array.isArray(message.to) ? message.to.join(",") : String(message.to),
    subject: String(message.subject).slice(0, 255),
    provider_override: message.provider || null,
    brand: message.brand || null,
  });

  const result = await runWithRetry(
    () => infraSendEmail.sendEmail(payloadForInfra),
    {
      maxAttempts: 5,
      baseDelayMs: 250,
      shouldRetry: (err) => {
        if (!err || typeof err !== "object") return true;
        const msg = String(err.message || "").toLowerCase();
        if (msg.includes("invalid email") || msg.includes("unverified domain")) {
          return false;
        }
        return true;
      },
    }
  );

  const latencyMs = Date.now() - start;

  const eventRecord = {
    correlation_id: correlationId,
    to: Array.isArray(message.to) ? message.to.join(",") : String(message.to),
    subject: String(message.subject).slice(0, 255),
    provider: result.provider || null,
    message_id: result.messageId || null,
    status: result.status,
    recorded_at: new Date().toISOString(),
    latency_ms: latencyMs,
  };

  await appendJsonl(EMAIL_LOG_FILE, eventRecord);

  logEmail("info", "sendEmail_success", {
    correlationId,
    provider: result.provider || null,
    message_id: result.messageId || null,
    status: result.status,
    latency_ms: latencyMs,
  });

  return {
    correlationId,
    provider: result.provider,
    messageId: result.messageId,
    status: result.status,
    raw: result.body,
  };
}

exports.CORE_EMAIL_VERSION = CORE_EMAIL_VERSION;
exports.sendEmail = sendEmail;

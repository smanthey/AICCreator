#!/usr/bin/env node
/**
 * webhook-server.js
 * ──────────────────────────────────────────────────────────────────────────
 * Standalone HTTP server for skynpatch.com — handles Maileroo delivery
 * webhooks at POST /api/webhook/maileroo
 *
 * Also handles GET /api/webhook/maileroo for the Maileroo verification ping.
 *
 * Deploy on skynpatch.com server:
 *   node scripts/webhook-server.js
 *
 * With PM2 (recommended):
 *   pm2 start scripts/webhook-server.js --name skynpatch-webhook
 *   pm2 save
 *
 * NGINX reverse proxy config (add to your skynpatch.com nginx config):
 *   location /api/webhook/ {
 *     proxy_pass http://127.0.0.1:4040;
 *     proxy_http_version 1.1;
 *     proxy_set_header Host $host;
 *     proxy_set_header X-Real-IP $remote_addr;
 *   }
 *
 * Environment:
 *   MAILEROO_WEBHOOK_SECRET=<your shared secret from Maileroo>
 *   WEBHOOK_PORT=4040  (optional, defaults to 4040)
 *
 * Maileroo event types handled:
 *   delivered    — email successfully delivered
 *   bounce       — hard or soft bounce
 *   complaint    — spam complaint (auto-unsubscribe)
 *   open         — email opened (tracking pixel)
 *   click        — link clicked
 *   unsubscribe  — recipient unsubscribed
 *
 * One-click unsubscribe: GET /api/webhook/unsubscribe?e=EMAIL&s=SIG
 * (same DB update as webhook; SIG = HMAC-SHA256(lowercase email, UNSUBSCRIBE_SECRET).hex)
 */
"use strict";

const http    = require("http");
const crypto  = require("crypto");
const path    = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const stripeHandler = require("./stripe-webhook-handler");
const loyalty = require("../control/loyalty/engine");
const { handleBotPurchase } = require("./bot-commerce-api");
const { getCredits } = require("./payment-router");
const { updateOutreachStatus, trackOutreachAttempt } = require("./bot-conversion-tracker");
const { v4: uuidv4 } = require("uuid");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

// Experiment engine — non-fatal if tables not yet migrated
let experiment = null;
try {
  experiment = require("./experiment-engine");
} catch (e) {
  console.warn(`[webhook] experiment engine unavailable: ${e.message}`);
}

const PORT   = parseInt(process.env.WEBHOOK_PORT || "4040");
const MAILEROO_SECRET = process.env.MAILEROO_WEBHOOK_SECRET;
const DUTCHIE_WEBHOOK_SECRET =
  process.env.DUTCHIE_WEBHOOK_SECRET ||
  process.env.DUTCHIE_SECRET ||
  "";
const WALLETPASS_WEBHOOK_SECRET =
  process.env.WALLETPASS_WEBHOOK_SECRET ||
  process.env.WALLET_PASS_WEBHOOK_SECRET ||
  process.env.WALLET_PASS_SECRET ||
  "";
const DISCORD_APPLICATION_ID =
  process.env.DISCORD_APPLICATION_ID ||
  process.env.DISCORD_APP_ID ||
  "";
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const UNSUBSCRIBE_SECRET =
  process.env.UNSUBSCRIBE_SECRET ||
  process.env.RESEND_WEBHOOK_SECRET ||
  process.env.MAILEROO_WEBHOOK_SECRET ||
  "";

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

if (!dbHost || !dbPass) {
  throw new Error("Missing DB env vars. Set POSTGRES_* (preferred) or CLAW_DB_* including password.");
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
});

function pickHeader(headers, keys = []) {
  for (const k of keys) {
    const v = headers[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}

function fallbackEventId(provider, eventType, rawBody) {
  const digest = crypto
    .createHash("sha256")
    .update(`${provider}:${eventType}:${rawBody || ""}`)
    .digest("hex")
    .slice(0, 24);
  return `${provider}_${digest}`;
}

// ── HMAC signature verification ───────────────────────────────────────────

function verifyMailerooSignature(rawBody, signatureHeader) {
  if (!MAILEROO_SECRET) {
    console.warn("[webhook] MAILEROO_WEBHOOK_SECRET not set — skipping signature check");
    return true;
  }
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", MAILEROO_SECRET)
    .update(rawBody)
    .digest("hex");
  // Maileroo sends "sha256=<hex>"
  const received = signatureHeader.replace(/^sha256=/, "");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(received, "hex")
    );
  } catch {
    return false;
  }
}

function verifyGenericHmacSha256(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const received = String(signatureHeader).replace(/^sha256=/i, "").trim();
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

const TASK_ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

async function ensureTaskRoutingColumns() {
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
}

function parseClawCommentCommand(body) {
  const text = String(body || "").trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cmdLine = lines.find((l) => /^\/claw(\s+|$)/i.test(l));
  if (!cmdLine) return null;

  const parts = cmdLine.split(/\s+/).filter(Boolean);
  const sub = String(parts[1] || "connect").toLowerCase();
  const rest = parts.slice(2).join(" ").trim();
  return { subcommand: sub, args: rest, raw: cmdLine };
}

function buildGithubTaskFromComment(payload) {
  const command = parseClawCommentCommand(payload?.comment?.body || "");
  if (!command) return null;

  const repo = String(payload?.repository?.full_name || "").trim();
  if (!repo) return null;
  const issueTitle = String(payload?.issue?.title || payload?.pull_request?.title || "GitHub comment request").trim();
  const actor = String(payload?.sender?.login || "unknown");
  const issueNumber = Number(payload?.issue?.number || payload?.pull_request?.number || 0) || null;
  const commentUrl = String(payload?.comment?.html_url || payload?.comment?.url || "");

  if (command.subcommand === "connect") {
    return {
      type: "opencode_controller",
      payload: {
        repo,
        objective: command.args || `Connect OpenClaw agents for ${repo} and establish comment-driven workflow`,
        source: "github_comment_connect",
        max_iterations: 2,
        quality_target: 90,
        auto_iterate: true,
        github_context: {
          actor,
          issue_number: issueNumber,
          issue_title: issueTitle,
          comment_url: commentUrl,
        },
      },
    };
  }

  if (command.subcommand === "task") {
    return {
      type: "opencode_controller",
      payload: {
        repo,
        objective: command.args || issueTitle || "Execute requested GitHub comment task",
        source: "github_comment_task",
        max_iterations: 2,
        quality_target: 90,
        auto_iterate: true,
        github_context: {
          actor,
          issue_number: issueNumber,
          issue_title: issueTitle,
          comment_url: commentUrl,
        },
      },
    };
  }

  if (command.subcommand === "research") {
    return {
      type: "research_signals",
      payload: {
        dry_run: false,
        source: "github_comment_research",
        repo,
        github_context: {
          actor,
          issue_number: issueNumber,
          issue_title: issueTitle,
          comment_url: commentUrl,
        },
      },
    };
  }

  return null;
}

async function taskExistsByIdempotency(idempotencyKey) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tasks WHERE idempotency_key = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, TASK_ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function enqueueCommentTask(taskType, taskPayload) {
  if (!isKnownTaskType(taskType)) {
    throw new Error(`unknown task type: ${taskType}`);
  }
  validatePayload(taskType, taskPayload);
  await ensureTaskRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(taskType, taskPayload);
  if (await taskExistsByIdempotency(idempotencyKey)) {
    return { queued: false, duplicate: true, idempotency_key: idempotencyKey };
  }

  const routing = resolveRouting(taskType);
  const id = uuidv4();
  await pool.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1, $2, $3::jsonb, 'CREATED', $4, $5, $6)`,
    [
      id,
      taskType,
      JSON.stringify(taskPayload || {}),
      routing.queue || "claw_tasks",
      routing.required_tags || [],
      idempotencyKey,
    ]
  );
  await pool.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { queued: true, duplicate: false, task_id: id, idempotency_key: idempotencyKey };
}

function discordPublicKeyToSpkiDer(publicKeyHex) {
  const keyHex = String(publicKeyHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(keyHex)) return null;
  // RFC 8410 Ed25519 SubjectPublicKeyInfo prefix
  const spkiPrefixHex = "302a300506032b6570032100";
  return Buffer.from(spkiPrefixHex + keyHex, "hex");
}

function verifyDiscordInteraction(rawBody, signatureHex, timestamp, publicKeyHex) {
  if (!rawBody || !signatureHex || !timestamp || !publicKeyHex) return false;
  if (!/^[0-9a-f]{128}$/i.test(String(signatureHex).trim())) return false;
  const keyDer = discordPublicKeyToSpkiDer(publicKeyHex);
  if (!keyDer) return false;
  try {
    const message = Buffer.from(String(timestamp) + String(rawBody), "utf8");
    const signature = Buffer.from(String(signatureHex).trim(), "hex");
    return crypto.verify(null, message, { key: keyDer, format: "der", type: "spki" }, signature);
  } catch {
    return false;
  }
}

function getInteractionOption(payload, name) {
  const options = Array.isArray(payload?.data?.options) ? payload.data.options : [];
  const found = options.find((o) => String(o?.name || "").toLowerCase() === String(name || "").toLowerCase());
  return found?.value;
}

function discordEphemeral(content) {
  return {
    type: 4,
    data: {
      content: String(content || ""),
      flags: 64,
    },
  };
}

const CLAWPAY_METHODS = [
  "ACH",
  "Credit/Debit cards",
  "Apple Pay",
  "Google Pay",
  "Cash App Pay",
  "Link",
  "USDC/USDT (via Stripe Crypto when enabled)",
];

// ── Event handlers ─────────────────────────────────────────────────────────

async function handleDelivered(event) {
  const { message_id, to } = event;
  console.log(`[webhook] delivered → message_id=${message_id} to=${to}`);
  await applyEmailSendUpdate(event, `status='delivered', delivered_at=NOW()`);
}

async function handleBounce(event) {
  const { message_id, to, bounce_type } = event;
  console.log(`[webhook] bounce (${bounce_type}) → message_id=${message_id} to=${to}`);
  await applyEmailSendUpdate(event, `status='bounced', bounce_type='${String(bounce_type || "unknown").replace(/'/g, "''")}'`);
  // Mark lead as bounced so we don't retry
  const { rows } = await pool.query(
    `SELECT lead_id
     FROM email_sends
     WHERE (maileroo_id = $1 OR (LOWER(to_email)=LOWER($2) AND subject = COALESCE($3, subject)))
     ORDER BY sent_at DESC
     LIMIT 1`,
    [message_id || null, to || null, event.subject || null]
  );
  if (rows[0]) {
    await pool.query(
      "UPDATE leads SET status='bounced', notes=COALESCE(notes||'; ','') || $1 WHERE id=$2",
      [`bounce:${bounce_type}:${new Date().toISOString()}`, rows[0].lead_id]
    );
  }
}

async function handleComplaint(event) {
  const { message_id, to } = event;
  console.log(`[webhook] ⚠️  COMPLAINT → message_id=${message_id} to=${to}`);
  await applyEmailSendUpdate(event, `status='complaint'`);
  // Auto-unsubscribe — CAN-SPAM compliance
  if (to) {
    await pool.query(
      "UPDATE leads SET status='unsubscribed', notes=COALESCE(notes||'; ','') || $1 WHERE email=LOWER($2)",
      [`spam_complaint:${new Date().toISOString()}`, to]
    );
    console.log(`[webhook] auto-unsubscribed ${to} due to spam complaint`);
  }
}

async function handleOpen(event) {
  const { message_id, to } = event;
  console.log(`[webhook] opened → message_id=${message_id} to=${to}`);
  await applyEmailSendUpdate(event, `opened_at=COALESCE(opened_at,NOW()), open_count=COALESCE(open_count,0)+1`);
  // Update lead engagement
  const { rows } = await pool.query(
    `SELECT lead_id
     FROM email_sends
     WHERE (maileroo_id = $1 OR (LOWER(to_email)=LOWER($2) AND subject = COALESCE($3, subject)))
     ORDER BY sent_at DESC
     LIMIT 1`,
    [message_id || null, to || null, event.subject || null]
  );
  if (rows[0]) {
    await pool.query(
      "UPDATE leads SET status=CASE WHEN status='emailed' THEN 'opened' ELSE status END WHERE id=$1",
      [rows[0].lead_id]
    );
    // Feed open event back to experiment engine for variant tracking
    if (experiment?.logEngagement) {
      experiment.logEngagement(rows[0].lead_id, 'open').catch(e =>
        console.warn(`[webhook] experiment open attribution failed: ${e.message}`)
      );
    }
  }
}

async function handleClick(event) {
  const { message_id, to, url } = event;
  console.log(`[webhook] clicked → ${url} — to=${to}`);
  await applyEmailSendUpdate(event, `clicked_at=COALESCE(clicked_at,NOW()), click_count=COALESCE(click_count,0)+1`);
  const { rows } = await pool.query(
    `SELECT lead_id
     FROM email_sends
     WHERE (maileroo_id = $1 OR (LOWER(to_email)=LOWER($2) AND subject = COALESCE($3, subject)))
     ORDER BY sent_at DESC
     LIMIT 1`,
    [message_id || null, to || null, event.subject || null]
  );
  if (rows[0]) {
    await pool.query(
      "UPDATE leads SET status='clicked', notes=COALESCE(notes||'; ','') || $1 WHERE id=$2",
      [`clicked:${url}:${new Date().toISOString()}`, rows[0].lead_id]
    );
    // Feed click event back to experiment engine for variant tracking
    if (experiment?.logEngagement) {
      experiment.logEngagement(rows[0].lead_id, 'click').catch(e =>
        console.warn(`[webhook] experiment click attribution failed: ${e.message}`)
      );
    }
  }
}

async function handleUnsubscribe(event) {
  const { message_id, to } = event;
  console.log(`[webhook] unsubscribe → ${to}`);
  if (to) {
    await pool.query(
      "UPDATE leads SET status='unsubscribed', notes=COALESCE(notes||'; ','') || $1 WHERE email=LOWER($2)",
      [`unsubscribed:${new Date().toISOString()}`, to]
    );
  }
  await applyEmailSendUpdate(event, "status='unsubscribed'");
  console.log(`[webhook] unsubscribed ${to}`);
}

function normalizeMailerooEvent(raw) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  const eventType = String(
    raw?.event ||
    raw?.type ||
    data?.event ||
    data?.type ||
    raw?.event_type ||
    data?.event_type ||
    ""
  ).toLowerCase();
  return {
    event: eventType,
    type: eventType,
    message_id: raw?.message_id || raw?.maileroo_id || data?.message_id || data?.id || raw?.id || null,
    to: raw?.to || raw?.recipient || raw?.email || data?.to || data?.recipient || data?.email || null,
    subject: raw?.subject || data?.subject || null,
    url: raw?.url || data?.url || data?.link || null,
    bounce_type: raw?.bounce_type || data?.bounce_type || data?.reason || null,
    raw_data: raw,
  };
}

async function applyEmailSendUpdate(event, setClauseSql) {
  const messageId = event.message_id || null;
  const toEmail = event.to ? String(event.to).toLowerCase() : null;
  const subject = event.subject || null;

  const params = [];
  let whereSql = "";
  if (messageId) {
    params.push(messageId);
    whereSql = `maileroo_id = $${params.length}`;
  } else if (toEmail) {
    params.push(toEmail);
    whereSql = `LOWER(to_email) = $${params.length} AND sent_at >= NOW() - INTERVAL '10 days'`;
    if (subject) {
      params.push(subject);
      whereSql += ` AND subject = $${params.length}`;
    }
  } else {
    return;
  }

  const q = `UPDATE email_sends SET ${setClauseSql} WHERE ${whereSql}`;
  await pool.query(q, params);
}

// ── HTTP server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "GET" && url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "webhook-server" }));
    return;
  }

  // Maileroo verification ping
  if (req.method === "GET" && url === "/api/webhook/maileroo") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // ── One-click unsubscribe (same DB update as Resend/Maileroo unsubscribe webhook) ──
  if (req.method === "GET" && url === "/api/webhook/unsubscribe") {
    const q = new URL(req.url || "", `http://${req.headers.host || "localhost"}`).searchParams;
    const email = (q.get("e") || q.get("email") || "").trim().toLowerCase();
    const sig = (q.get("s") || q.get("sig") || "").trim();
    const expectedHmac = crypto.createHmac("sha256", UNSUBSCRIBE_SECRET).update(email).digest();
    const receivedBuf = Buffer.from(sig, "hex");
    const ok =
      email &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      UNSUBSCRIBE_SECRET &&
      receivedBuf.length === expectedHmac.length &&
      crypto.timingSafeEqual(expectedHmac, receivedBuf);
    if (!ok) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><body><p>Invalid or expired unsubscribe link. Reply UNSUBSCRIBE to the email or contact shop@skynpatch.com to be removed.</p></body></html>"
      );
      return;
    }
    try {
      await pool.query(
        "UPDATE leads SET status='unsubscribed', notes=COALESCE(notes||'; ','') || $1 WHERE email=$2",
        [`link:${new Date().toISOString()}`, email]
      );
      console.log(`[webhook] unsubscribed ${email} (one-click link)`);
    } catch (err) {
      console.error(`[webhook] unsubscribe DB error: ${err.message}`);
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Unsubscribed</title></head><body style=\"font-family:sans-serif;max-width:480px;margin:2rem auto;padding:1rem;\"><h1>You're unsubscribed</h1><p>You won't receive further Skyn Patch wholesale emails. To resubscribe or for questions, contact <a href=\"mailto:shop@skynpatch.com\">shop@skynpatch.com</a>.</p></body></html>"
    );
    return;
  }

  // ── Stripe webhook ─────────────────────────────────────────
  if (req.method === "POST" && url === "/api/webhook/stripe") {
    let rawBody = "";
    req.on("data", chunk => rawBody += chunk);
    req.on("end", async () => {
      const sig = req.headers["stripe-signature"] || "";
      const result = await stripeHandler.handleStripeWebhook(rawBody, sig);
      res.writeHead(result.code, { "Content-Type": "text/plain" });
      res.end(result.message || "ok");
    });
    return;
  }

  // ── Discord interactions webhook ──────────────────────────
  if (
    req.method === "POST" &&
    (url === "/api/discord/interactions" ||
      url === "/api/webhook/discord-interactions" ||
      url === "/api/webhooks/discord-interactions")
  ) {
    let rawBody = "";
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", async () => {
      const signature = req.headers["x-signature-ed25519"] || "";
      const timestamp = req.headers["x-signature-timestamp"] || "";
      const valid = verifyDiscordInteraction(rawBody, signature, timestamp, DISCORD_PUBLIC_KEY);
      if (!valid) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("invalid signature");
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("bad json");
        return;
      }

      // Discord validation ping
      if (payload.type === 1) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: 1 }));
        return;
      }

      const commandName = String(payload?.data?.name || "").toLowerCase();
      const userId = String(payload?.member?.user?.id || payload?.user?.id || payload?.member?.user?.username || "discord_user");

      if (payload.type === 2) {
        if (commandName === "oracle") {
          const response = discordEphemeral(
            "OpenClaw slash commerce is active. Commands: `/buy1` for a $1 checkout link, `/paymethods` for accepted rails, `/credits` for API credits."
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        if (commandName === "paymethods") {
          const response = discordEphemeral(
            `Accepted payment methods:\n- ${CLAWPAY_METHODS.join("\n- ")}\n\nUse \`/buy1\` to generate a $1 checkout link.`
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        if (commandName === "credits") {
          try {
            const credits = await getCredits(userId);
            const response = discordEphemeral(
              `Credits for \`${userId}\`:\n- Balance: ${Number(credits?.balance || 0)}\n- Purchased: ${Number(credits?.purchased || 0)}\n- Spent: ${Number(credits?.spent || 0)}`
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          } catch (err) {
            const response = discordEphemeral(`Could not fetch credits right now: ${err.message}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }
        }

        if (commandName === "buy1") {
          const protocolType = String(getInteractionOption(payload, "protocol") || "agent-intro");
          try {
            const purchase = await handleBotPurchase({
              botId: userId,
              platform: "discord",
              protocolType,
              context: {
                botPlatform: "Discord",
                botPurpose: "bot-to-bot outreach and protocol exchange",
                targetBots: "open bot agents",
              },
              paymentMethod: "stripe",
              operatorName: "OpenClaw Discord Interaction",
            });

            const paymentUrl = purchase?.payment_url || null;
            await updateOutreachStatus({
              botId: userId,
              platform: "discord",
              status: "responded",
              metadata: { source: "discord_interaction", command: "buy1", protocol_type: protocolType },
            });
            await trackOutreachAttempt({
              botId: userId,
              platform: "discord",
              messageVariant: "SLASH_BUY1",
              messageContent: null,
              status: paymentUrl ? "responded" : "rejected",
              metadata: {
                source: "discord_interaction",
                command: "buy1",
                protocol_type: protocolType,
                payment_url_included: Boolean(paymentUrl),
              },
            });

            const response = discordEphemeral(
              paymentUrl
                ? `Your $1 checkout link is ready:\n${paymentUrl}\n\nAfter payment, the prompt is delivered automatically.`
                : "Could not generate a checkout link right now. Please retry in a minute."
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          } catch (err) {
            const response = discordEphemeral(`Checkout setup failed: ${err.message}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(discordEphemeral("OpenClaw interactions endpoint is active.")));
    });
    return;
  }

  // ── GitHub webhook (issue/PR comments -> task queue) ─────
  if (
    req.method === "POST" &&
    (url === "/api/webhook/github" || url === "/api/webhooks/github")
  ) {
    let rawBody = "";
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", async () => {
      const signature =
        req.headers["x-hub-signature-256"] ||
        req.headers["x-hub-signature"] ||
        "";
      const event = String(req.headers["x-github-event"] || "").toLowerCase();
      const delivery = String(req.headers["x-github-delivery"] || "");

      if (!GITHUB_WEBHOOK_SECRET) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("github webhook secret not configured");
        return;
      }

      const ok = verifyGenericHmacSha256(rawBody, signature, GITHUB_WEBHOOK_SECRET);
      if (!ok) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("unauthorized");
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("bad json");
        return;
      }

      try {
        let queued = null;
        if (
          (event === "issue_comment" || event === "pull_request_review_comment") &&
          String(payload?.action || "").toLowerCase() === "created"
        ) {
          const task = buildGithubTaskFromComment(payload);
          if (task) {
            queued = await enqueueCommentTask(task.type, task.payload);
          }
        }

        console.log(
          `[webhook] github event=${event} delivery=${delivery || "n/a"} queued=${queued?.queued ? "yes" : queued?.duplicate ? "duplicate" : "no"}`
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, event, delivery, queued }));
      } catch (err) {
        console.error(`[webhook] github handler error: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // ── Dutchie loyalty webhook ────────────────────────────────
  if (
    req.method === "POST" &&
    (url === "/api/webhook/dutchie" ||
      url === "/api/webhook/dutchie/" ||
      url === "/api/webhooks/dutchie")
  ) {
    let rawBody = "";
    req.on("data", chunk => rawBody += chunk);
    req.on("end", async () => {
      try {
        const sig =
          req.headers["x-dutchie-signature"] ||
          req.headers["x-webhook-signature"] ||
          req.headers["x-signature"] ||
          "";
        const ok = verifyGenericHmacSha256(rawBody, sig, DUTCHIE_WEBHOOK_SECRET);
        if (!ok) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("unauthorized");
          return;
        }
        const payload = JSON.parse(rawBody || "{}");
        const eventType = payload.event || payload.type || "unknown";
        const eventId =
          payload.event_id ||
          payload.id ||
          payload.order?.id ||
          payload.data?.id ||
          fallbackEventId("dutchie", eventType, rawBody);
        await loyalty.enqueueWebhook(pool, {
          provider: "dutchie",
          eventType,
          eventId,
          signatureValid: true,
          payload,
          sourceSystem: "dutchie",
          eventVersion: payload.event_version || payload.version || pickHeader(req.headers, ["x-event-version", "x-dutchie-event-version"]),
          schemaVersion: payload.schema_version || pickHeader(req.headers, ["x-schema-version", "x-dutchie-schema-version"]),
          headers: {
            signature: String(sig || ""),
            request_id: pickHeader(req.headers, ["x-request-id"]),
            source_ip: pickHeader(req.headers, ["x-real-ip", "x-forwarded-for"]),
            user_agent: pickHeader(req.headers, ["user-agent"]),
          },
        });
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      } catch (e) {
        console.error(`[webhook] dutchie handler error: ${e.message}`);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("error");
      }
    });
    return;
  }

  // ── Wallet pass webhook ────────────────────────────────────
  if (
    req.method === "POST" &&
    (url === "/api/webhook/wallet-pass" ||
      url === "/api/webhook/wallet-pass/" ||
      url === "/api/webhooks/wallet-pass")
  ) {
    let rawBody = "";
    req.on("data", chunk => rawBody += chunk);
    req.on("end", async () => {
      try {
        const sig =
          req.headers["x-walletpass-signature"] ||
          req.headers["x-wallet-pass-signature"] ||
          req.headers["x-webhook-signature"] ||
          req.headers["x-signature"] ||
          "";
        const ok = verifyGenericHmacSha256(rawBody, sig, WALLETPASS_WEBHOOK_SECRET);
        if (!ok) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("unauthorized");
          return;
        }
        const payload = JSON.parse(rawBody || "{}");
        let eventType =
          payload.event ||
          payload.type ||
          payload.eventType ||
          payload.data?.event ||
          payload.data?.type ||
          "wallet_pass.event";
        const normalizedWalletMap = {
          pass_issued: "wallet.pass.issued",
          pass_activated: "wallet.pass.activated",
          pass_scanned: "wallet.pass.scanned",
          pass_updated: "wallet.pass.updated",
          pass_expired: "wallet.pass.expired",
          pass_revoked: "wallet.pass.revoked",
        };
        const lowerType = String(eventType).toLowerCase();
        if (normalizedWalletMap[lowerType]) eventType = normalizedWalletMap[lowerType];
        if (!String(eventType).toLowerCase().startsWith("wallet.pass.")) {
          eventType = `wallet.pass.${String(eventType).toLowerCase().replace(/\s+/g, "_")}`;
        }
        const eventId =
          payload.event_id ||
          payload.id ||
          payload.pass_id ||
          payload.wallet_pass_id ||
          payload.data?.event_id ||
          payload.data?.id ||
          payload.data?.pass_id ||
          payload.data?.wallet_pass_id ||
          fallbackEventId("wallet_pass", eventType, rawBody);
        await loyalty.enqueueWebhook(pool, {
          provider: "wallet_pass",
          eventType,
          eventId,
          signatureValid: true,
          payload,
          sourceSystem: "wallet_pass",
          eventVersion: payload.event_version || payload.version || pickHeader(req.headers, ["x-event-version", "x-walletpass-event-version"]),
          schemaVersion: payload.schema_version || pickHeader(req.headers, ["x-schema-version", "x-walletpass-schema-version"]),
          headers: {
            signature: String(sig || ""),
            request_id: pickHeader(req.headers, ["x-request-id"]),
            source_ip: pickHeader(req.headers, ["x-real-ip", "x-forwarded-for"]),
            user_agent: pickHeader(req.headers, ["user-agent"]),
          },
        });
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      } catch (e) {
        console.error(`[webhook] wallet-pass handler error: ${e.message}`);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("error");
      }
    });
    return;
  }

  // Only accept POST to our Maileroo path
  if (req.method !== "POST" || url !== "/api/webhook/maileroo") {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  // Read body
  let rawBody = "";
  req.on("data", chunk => rawBody += chunk);
  req.on("end", async () => {
    // Verify signature
    const sig = req.headers["x-maileroo-signature"] || req.headers["x-webhook-signature"] || "";
    if (!verifyMailerooSignature(rawBody, sig)) {
      console.warn("[webhook] ⚠️  invalid signature — rejected");
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("unauthorized");
      return;
    }

    let event;
    try { event = JSON.parse(rawBody); }
    catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad json");
      return;
    }

    event = normalizeMailerooEvent(event);
    const eventType = (event.event || event.type || "").toLowerCase();
    console.log(`[webhook] event=${eventType} to=${event.to} msg=${event.message_id}`);

    try {
      switch (eventType) {
        case "delivered":    await handleDelivered(event);   break;
        case "bounce":
        case "hard_bounce":
        case "soft_bounce":  await handleBounce(event);      break;
        case "complaint":
        case "spam":         await handleComplaint(event);   break;
        case "open":
        case "opened":       await handleOpen(event);        break;
        case "click":
        case "clicked":      await handleClick(event);       break;
        case "unsubscribe":
        case "unsubscribed": await handleUnsubscribe(event); break;
        default:
          console.log(`[webhook] unhandled event type: ${eventType}`);
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } catch (e) {
      console.error(`[webhook] handler error for ${eventType}: ${e.message}`);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("error");
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[webhook] Maileroo webhook server listening on 127.0.0.1:${PORT}`);
  console.log(`[webhook] Path: POST /api/webhook/maileroo`);
  console.log(`[webhook] Path: POST /api/webhook/dutchie`);
  console.log(`[webhook] Path: POST /api/webhook/wallet-pass`);
  console.log(`[webhook] Path: POST /api/discord/interactions`);
  console.log(`[webhook] Path: POST /api/webhook/github`);
  console.log(`[webhook] Maileroo signature verification: ${MAILEROO_SECRET ? "ENABLED" : "DISABLED (set MAILEROO_WEBHOOK_SECRET)"}`);
  console.log(`[webhook] Discord interaction verification: ${DISCORD_PUBLIC_KEY ? "ENABLED" : "DISABLED (set DISCORD_PUBLIC_KEY)"}`);
  console.log(`[webhook] GitHub webhook verification: ${GITHUB_WEBHOOK_SECRET ? "ENABLED" : "DISABLED (set GITHUB_WEBHOOK_SECRET)"}`);
  if (DISCORD_APPLICATION_ID) {
    console.log(`[webhook] Discord application id configured: ${DISCORD_APPLICATION_ID}`);
  }
});

process.on("SIGTERM", () => { server.close(() => pool.end()); });
process.on("SIGINT",  () => { server.close(() => pool.end()); });

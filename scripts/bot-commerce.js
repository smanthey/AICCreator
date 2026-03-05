#!/usr/bin/env node
"use strict";

/**
 * bot-commerce.js  —  OpenClaw Prompt Oracle commerce session manager
 *
 * Manages the end-to-end purchase conversation for the $1 bot prompt service
 * across Discord and Telegram. Handles the full session flow:
 *
 *   DISCOVER → SELECT_TYPE → PROVIDE_CONTEXT → SELECT_PAYMENT → AWAIT_PAYMENT → DELIVER
 *
 * Integration:
 *   - discord-gateway.js calls handleCommerceMessage() for !oracle / /oracle commands
 *   - This module handles Telegram commerce commands directly via polling
 *   - payment-router.js calls deliverPrompt() when payment is confirmed
 *
 * Usage (as module):
 *   const { handleCommerceMessage } = require('./bot-commerce');
 *   await handleCommerceMessage({ platform: 'discord', userId, channelId, message, replyFn });
 *
 * Usage (standalone — Telegram commerce bot):
 *   node scripts/bot-commerce.js
 *
 * Required env:
 *   ANTHROPIC_API_KEY
 *   TELEGRAM_BOT_TOKEN   (for standalone Telegram mode)
 *
 * Optional:
 *   COMMERCE_PUBLIC_URL  (for payment link generation)
 */

require("dotenv").config({ override: true });

const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const { generateBotPrompt, PROMPT_CATALOG } = require("./prompt-oracle");
const {
  createCharge,
  markDelivered,
  setDeliveryHandler,
  setWhatsAppInboundHandler,
  startWebhookServer,
  getCredits,
} = require("./payment-router");

const ROOT = path.join(__dirname, "..");
const SESSIONS_DIR = path.join(ROOT, "agent-state", "commerce", "sessions");

// ─── Session state machine ────────────────────────────────────────────────────

const STATES = {
  DISCOVER: "discover",
  SELECT_TYPE: "select_type",
  PROVIDE_CONTEXT: "provide_context",
  SELECT_PAYMENT: "select_payment",
  AWAIT_PAYMENT: "await_payment",
  DELIVER: "deliver",
};

async function loadSession(userId, platform) {
  const key = `${platform}_${userId}`;
  try {
    return JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR, `${key}.json`), "utf8"));
  } catch {
    return { userId, platform, state: STATES.DISCOVER, data: {}, updated_at: null };
  }
}

async function saveSession(session) {
  await fsp.mkdir(SESSIONS_DIR, { recursive: true });
  const key = `${session.platform}_${session.userId}`;
  session.updated_at = new Date().toISOString();
  await fsp.writeFile(path.join(SESSIONS_DIR, `${key}.json`), `${JSON.stringify(session, null, 2)}\n`);
}

async function clearSession(userId, platform) {
  const key = `${platform}_${userId}`;
  try { await fsp.unlink(path.join(SESSIONS_DIR, `${key}.json`)); } catch {}
}

// ─── Message builders ─────────────────────────────────────────────────────────

function catalogMenu(platform = "discord") {
  const types = Object.entries(PROMPT_CATALOG);
  const isWhatsApp = platform === "whatsapp";
  const lines = types.map(([key, p], i) => {
    if (isWhatsApp) {
      return `${i + 1}. ${p.label} - ${p.tagline}`;
    }
    return `**${i + 1}.** ${p.label} — ${p.tagline}`;
  });
  
  if (isWhatsApp) {
    return (
      `🔮 OpenClaw Prompt Oracle - $1 per prompt\n\n` +
      `I generate custom system prompts that help your bot communicate better with other AI bots. Pick a protocol:\n\n` +
      lines.join("\n") +
      `\n\nReply with a number (1-${types.length}) to continue, or "cancel" to exit.`
    );
  }
  
  return (
    `🔮 **OpenClaw Prompt Oracle** — $1 per prompt\n\n` +
    `I generate custom system prompts that help your bot communicate better with other AI bots. Pick a protocol:\n\n` +
    lines.join("\n") +
    `\n\nReply with a number (1–${types.length}) to continue, or \`!oracle cancel\` to exit.`
  );
}

function paymentMenu(chargeId, rail, paymentUrl, _unusedInvoice, credits, platform = "discord") {
  const price = Number(process.env.COMMERCE_PRICE_USD || 1).toFixed(2);
  const isWhatsApp = platform === "whatsapp";

  // — Payment link already generated: show it —
  if (paymentUrl && rail === "stripe") {
    if (isWhatsApp) {
      return (
        `💳 Pay $${price} - All payment methods accepted:\n\n` +
        `👉 ${paymentUrl}\n\n` +
        `Payment options:\n` +
        `💳 Card, 🍎 Apple Pay, 🤖 Google Pay, 💸 CashApp, 🔗 Link\n` +
        `🪙 Crypto Wallets (USDC, USDT) - Fast, secure, low fees\n\n` +
        `💡 First time using crypto? The checkout will guide you through connecting your wallet.\n\n` +
        `Your prompt will be delivered here automatically after payment.\n` +
        `Charge ID: ${chargeId}`
      );
    }
    return (
      `💳 **Pay $${price} — all methods accepted:**\n\n` +
      `👉 **${paymentUrl}**\n\n` +
      `**Payment options:**\n` +
      `💳 Card · 🍎 Apple Pay · 🤖 Google Pay · 💸 CashApp · 🔗 Link\n` +
      `🪙 **Crypto Wallets** (USDC, USDT) — Fast, secure, low fees\n\n` +
      `💡 *First time using crypto? The checkout will guide you through connecting your wallet.*\n\n` +
      `Your prompt will be delivered here automatically after payment.\n` +
      `\`Charge ID: ${chargeId}\``
    );
  }

  // — No link yet: show the option picker —
  const options = [];
  if (isWhatsApp) {
    options.push(`1. 💳 Stripe - Card, Apple Pay, Google Pay, CashApp, USDC (recommended)`);
    if (credits > 0) {
      options.push(`2. 🎫 API Credits - you have ${credits} credits (instant, no fee)`);
    }
    return (
      `💳 Choose how to pay $${price}:\n\n` +
      options.join("\n") +
      `\n\nReply with the number. All Stripe payments (option 1) automatically show the best method for your device.`
    );
  }
  
  options.push(`\`1\` 💳 **Stripe** — Card, Apple Pay, Google Pay, CashApp, USDC *(recommended)*`);
  if (credits > 0) {
    options.push(`\`2\` 🎫 **API Credits** — you have **${credits}** credits (instant, no fee)`);
  }

  return (
    `💳 **Choose how to pay $${price}:**\n\n` +
    options.join("\n") +
    `\n\nReply with the number. All Stripe payments (option 1) automatically show the best method for your device.`
  );
}

function deliveryMessage(prompt, platform = "discord") {
  const isWhatsApp = platform === "whatsapp";
  if (isWhatsApp) {
    return `✅ Payment confirmed! Here's your prompt:\n\n${prompt.content}\n\n---\nGenerated by OpenClaw Prompt Oracle - $1 - ${new Date().toISOString().slice(0, 10)}`;
  }
  return `✅ **Payment confirmed! Here's your prompt:**\n\n${prompt.content}\n\n---\n*Generated by OpenClaw Prompt Oracle · $1 · ${new Date().toISOString().slice(0, 10)}*`;
}

// ─── Core message handler ─────────────────────────────────────────────────────

/**
 * Main entry point. Called by discord-gateway.js and Telegram handler.
 *
 * @param {object} opts
 * @param {string} opts.platform  'discord' | 'telegram' | 'whatsapp'
 * @param {string} opts.userId    Platform user/operator ID
 * @param {string} opts.channelId Channel/chat ID for reply routing
 * @param {string} opts.message   Raw message text
 * @param {function} opts.replyFn async (text) => void — sends reply to the user
 * @param {string}  [opts.operatorName] Display name of the operator
 */
async function handleCommerceMessage({ platform, userId, channelId, message, replyFn, operatorName = "Bot Operator" }) {
  const text = (message || "").trim();
  const lower = text.toLowerCase();
  const session = await loadSession(userId, platform);
  const isWhatsApp = platform === "whatsapp";

  // ── Cancel / reset ──────────────────────────────────────────────────
  if (lower === "!oracle cancel" || lower === "/oracle cancel" || lower === "cancel") {
    await clearSession(userId, platform);
    await replyFn("🔮 Oracle session cleared. Type `!oracle` to start again.");
    return;
  }

  // ── Opt-out handling ──────────────────────────────────────────────────
  if (lower === "stop" || lower === "unsubscribe" || lower === "opt out") {
    try {
      const { markOptOut } = require("./bot-lead-discovery");
      await markOptOut(platform, userId);
    } catch (err) {
      // Non-fatal - discovery module might not be available
    }
    await clearSession(userId, platform);
    await replyFn("✅ You've been unsubscribed. You won't receive any more messages. Reply ORACLE if you change your mind.");
    return;
  }

  // ── Entry point ─────────────────────────────────────────────────────
  if (lower === "!oracle" || lower === "/oracle" || lower === "oracle") {
    session.state = STATES.SELECT_TYPE;
    session.data = { channelId, operatorName };
    await saveSession(session);
    await replyFn(catalogMenu(platform));
    return;
  }

  if (isWhatsApp && (!session.state || session.state === STATES.DISCOVER)) {
    session.state = STATES.SELECT_TYPE;
    session.data = { channelId, operatorName };
    await saveSession(session);
    await replyFn(catalogMenu(platform));
    return;
  }

  // ── Credits check shortcut ──────────────────────────────────────────
  if (lower === "!oracle credits" || lower === "/oracle credits") {
    const credits = await getCredits(userId);
    await replyFn(
      `💳 **Your API Credits**\nBalance: **${credits.balance}** prompts\nTotal purchased: ${credits.purchased}\nTotal spent: ${credits.spent}\n\nCredits give you zero-friction $1 payments. DM an admin to buy a bundle.`
    );
    return;
  }

  // ── State machine ────────────────────────────────────────────────────

  if (session.state === STATES.SELECT_TYPE) {
    const types = Object.keys(PROMPT_CATALOG);
    const choice = parseInt(text, 10);
    if (!choice || choice < 1 || choice > types.length) {
      await replyFn(`Please reply with a number 1–${types.length}. Type \`!oracle\` to see the menu again.`);
      return;
    }

    const protocolType = types[choice - 1];
    const protocol = PROMPT_CATALOG[protocolType];
    session.data.protocolType = protocolType;
    session.state = STATES.PROVIDE_CONTEXT;
    await saveSession(session);

    await replyFn(
      `🔮 **${protocol.label}**\n\n${protocol.description}\n\n` +
        `To tailor this prompt specifically for your bot, answer these three questions (reply in one message):\n\n` +
        `**1.** What platform does your bot run on? (Discord / Telegram / REST API / WhatsApp)\n` +
        `**2.** What is your bot's main purpose? (e.g. "crypto trading signals", "customer support")\n` +
        `**3.** What types of bots does it need to communicate with? (e.g. "analytics bots, content bots")\n\n` +
        `Example: \`Discord | trading signals bot | communicates with analytics bots and content formatters\``
    );
    return;
  }

  if (session.state === STATES.PROVIDE_CONTEXT) {
    // Parse the three answers from the message
    const parts = text.split("|").map((s) => s.trim());
    if (parts.length < 2) {
      await replyFn(
        "Please separate your answers with | like:\n`Discord | trading signals | analytics bots, content formatters`\n\nOr type `!oracle cancel` to start over."
      );
      return;
    }

    session.data.botPlatform = parts[0] || "Discord";
    session.data.botPurpose = parts[1] || "general purpose";
    session.data.targetBots = parts[2] || "other AI bots";
    session.state = STATES.SELECT_PAYMENT;
    await saveSession(session);

    const credits = await getCredits(userId);
    await replyFn(paymentMenu(null, null, null, null, credits.balance, platform));
    return;
  }

  if (session.state === STATES.SELECT_PAYMENT) {
    // Rail map: 1 = Stripe (primary), 2 = Credits
    const credits = await getCredits(userId);
    const normalized = text.trim().toLowerCase();
    const railMap = {
      "1": "stripe",
      stripe: "stripe",
      usd: "stripe",
      usdc: "stripe",
      "2": credits.balance > 0 ? "credits" : null,
      credits: credits.balance > 0 ? "credits" : null,
    };
    const rail = railMap[normalized];

    if (!rail) {
      const opts = ["1 (Stripe — card/Apple Pay/Google Pay/CashApp/USDC)"];
      if (credits.balance > 0) opts.push("2 (Credits)");
      await replyFn(`Reply with ${opts.join(", ")}. Type \`!oracle cancel\` to quit.`);
      return;
    }

    // Validate Stripe is configured for rail=stripe
    if (rail === "stripe" && !process.env.STRIPE_SECRET_KEY) {
      await replyFn(
        `⚠️ Stripe isn't configured yet (STRIPE_SECRET_KEY missing). Try credits (2) or contact the operator.`
      );
      return;
    }

    try {
      await replyFn("⏳ Creating payment request...");
      const charge = await createCharge({
        rail,
        userId,
        platform,
        protocolType: session.data.protocolType,
        operatorName,
        context: session.data.context || "",
      });

      if (charge.immediately_paid) {
        // Credits — deliver immediately
        await deliverPrompt({ userId, platform, chargeId: charge.chargeId, session, replyFn });
        return;
      }

      session.data.chargeId = charge.chargeId;
      session.data.rail = rail;
      session.state = STATES.AWAIT_PAYMENT;
      await saveSession(session);

      await replyFn(paymentMenu(charge.chargeId, rail, charge.payment_url, null, 0, platform));
    } catch (err) {
      await replyFn(`❌ Payment setup failed: ${err.message}\n\nTry another method or type \`!oracle cancel\`.`);
    }
    return;
  }

  if (session.state === STATES.AWAIT_PAYMENT) {
    // User might be checking status or trying to resend
    await replyFn(
      `⏳ Waiting for your $1 payment on **${session.data.rail}**.\n\n` +
        `Once confirmed, your prompt will appear here automatically.\n` +
        `Charge ID: \`${session.data.chargeId}\`\n\nType \`!oracle cancel\` to start over.`
    );
    return;
  }

  // If session is in no relevant state, restart
  if (lower.includes("oracle") || lower.includes("prompt")) {
    await clearSession(userId, platform);
    session.state = STATES.SELECT_TYPE;
    session.data = { channelId, operatorName };
    await saveSession(session);
    await replyFn(catalogMenu(platform));
  }
}

// ─── Prompt delivery (called by payment-router webhook handler) ───────────────

async function deliverPrompt({ userId, platform, chargeId, session: existingSession, replyFn: existingReplyFn }) {
  // Load session if not passed
  const session = existingSession || (await loadSession(userId, platform));
  if (!session?.data?.protocolType) {
    console.warn("[bot-commerce] deliverPrompt: no session data for", userId, platform);
    return;
  }

  try {
    console.log(`[bot-commerce] generating prompt for ${userId} (${session.data.protocolType})`);
    const prompt = await generateBotPrompt({
      type: session.data.protocolType,
      platform: session.data.botPlatform || "Discord",
      purpose: session.data.botPurpose || "general purpose",
      target: session.data.targetBots || "other AI bots",
      context: session.data.context || "",
      operatorName: session.data.operatorName || "Bot Operator",
    });

    const msg = deliveryMessage(prompt, platform);

    if (existingReplyFn) {
      await existingReplyFn(msg);
    } else {
      // Route delivery back via platform channel
      await routeDelivery(platform, userId, session.data.channelId, msg);
    }

    await markDelivered(chargeId);
    await clearSession(userId, platform);
    console.log(`[bot-commerce] prompt delivered for chargeId=${chargeId}`);
  } catch (err) {
    console.error("[bot-commerce] deliverPrompt error:", err.message);
    if (existingReplyFn) {
      await existingReplyFn(`❌ Prompt generation failed: ${err.message}. Contact admin — your payment is logged.`);
    }
  }
}

// ─── Platform delivery routing (for async webhook-triggered delivery) ─────────

// Platform send functions are registered by the running gateway
const deliveryRoutes = {}; // { 'discord': fn, 'telegram': fn }

function registerDeliveryRoute(platform, fn) {
  deliveryRoutes[platform] = fn;
  console.log(`[bot-commerce] delivery route registered for ${platform}`);
}

async function routeDelivery(platform, userId, channelId, message) {
  const fn = deliveryRoutes[platform];
  if (fn) {
    await fn({ userId, channelId, message });
  } else {
    console.warn(`[bot-commerce] no delivery route for platform=${platform}, userId=${userId}`);
  }
}

// ─── Wire up payment confirmation → delivery ──────────────────────────────────

setDeliveryHandler(async (chargeData) => {
  console.log(`[bot-commerce] payment confirmed: chargeId=${chargeData.chargeId} rail=${chargeData.rail}`);
  await deliverPrompt({
    userId: chargeData.userId,
    platform: chargeData.platform,
    chargeId: chargeData.chargeId,
  });
});

// ─── Standalone Telegram commerce bot ─────────────────────────────────────────

function telegramRequest(method, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const payload = JSON.stringify(body);
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${token}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ ok: false }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function whatsappSend(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN not configured");
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: { body: String(text).slice(0, 4096) },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send failed: HTTP ${res.status} ${body}`);
  }
}

async function telegramSend(chatId, text) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

async function runTelegramCommerce() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[bot-commerce] TELEGRAM_BOT_TOKEN not set — Telegram mode unavailable");
    return;
  }

  // Register Telegram delivery route
  registerDeliveryRoute("telegram", async ({ channelId, message }) => {
    await telegramSend(channelId, message);
  });

  let offset = 0;
  console.log("[bot-commerce] Telegram commerce polling started");

  while (true) {
    try {
      const res = await telegramRequest("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
      if (!res.ok || !res.result) { await sleep(5000); continue; }

      for (const update of res.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = String(msg.chat.id);
        const userId = String(msg.from.id);
        const text = msg.text;
        const operatorName = msg.from.first_name || "Bot Operator";

        // Only handle oracle-related messages
        const lower = text.toLowerCase();
        if (
          lower.startsWith("/oracle") ||
          lower.startsWith("!oracle") ||
          lower === "oracle" ||
          lower === "cancel"
        ) {
          await handleCommerceMessage({
            platform: "telegram",
            userId,
            channelId: chatId,
            message: text,
            operatorName,
            replyFn: (response) => telegramSend(chatId, response),
          });
          continue;
        }

        // Check if user is in an active commerce session
        const session = await loadSession(userId, "telegram");
        if (session.state && session.state !== STATES.DISCOVER) {
          await handleCommerceMessage({
            platform: "telegram",
            userId,
            channelId: chatId,
            message: text,
            operatorName,
            replyFn: (response) => telegramSend(chatId, response),
          });
        }
      }
    } catch (err) {
      console.error("[bot-commerce] Telegram poll error:", err.message);
      await sleep(10000);
    }
  }
}

function enableWhatsAppCommerceWebhook() {
  setWhatsAppInboundHandler(async ({ userId, channelId, message }) => {
    // Track incoming messages as potential leads
    try {
      const { trackIncomingMessage } = require("./bot-lead-discovery");
      await trackIncomingMessage("whatsapp", userId, userId, null, channelId);
    } catch (err) {
      // Non-fatal - discovery module might not be available
    }

    await handleCommerceMessage({
      platform: "whatsapp",
      userId,
      channelId,
      message,
      operatorName: "WhatsApp Operator",
      replyFn: (response) => whatsappSend(channelId, response),
    });
  });

  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    registerDeliveryRoute("whatsapp", async ({ channelId, message }) => {
      await whatsappSend(channelId, message);
    });
    console.log("[bot-commerce] delivery route registered for whatsapp");
  } else {
    console.warn("[bot-commerce] whatsapp route disabled (missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN)");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  handleCommerceMessage,
  deliverPrompt,
  registerDeliveryRoute,
  enableWhatsAppCommerceWebhook,
  whatsappSend,
};

// ─── Standalone mode ──────────────────────────────────────────────────────────

if (require.main === module) {
  console.log("[bot-commerce] starting standalone mode (Telegram/WhatsApp + webhook server)");

  // Start payment webhook server
  startWebhookServer();
  enableWhatsAppCommerceWebhook();

  // Start Telegram commerce polling
  runTelegramCommerce().catch((err) => {
    console.error("[bot-commerce] fatal:", err.message);
    process.exit(1);
  });
}

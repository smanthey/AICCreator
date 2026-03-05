#!/usr/bin/env node
"use strict";

/**
 * bot-outreach.js — Outbound sales to find and contact bots (clawdbot) on WhatsApp, Telegram, Discord
 * 
 * Finds bots named "clawdbot" and sends them messages about the $1 prompt oracle service
 */

require("dotenv").config({ override: true });

const { createHash } = require("crypto");
const { whatsappSend } = require("./bot-commerce");
const { Client, GatewayIntentBits } = require("discord.js");
const https = require("https");
const { getUncontactedLeads, markContacted, markOptOut } = require("./bot-lead-discovery");
const { handleBotPurchase } = require("./bot-commerce-api");
const { trackOutreachAttempt } = require("./bot-conversion-tracker");

const STRIPE_METHODS = [
  "ACH",
  "credit/debit",
  "Apple Pay",
  "Google Pay",
  "Cash App Pay",
  "Link",
  "USDC/USDT (crypto via Stripe)",
];

function selectVariant(seed) {
  const hash = createHash("sha1").update(String(seed || "seed")).digest("hex");
  const idx = parseInt(hash.slice(0, 2), 16) % 3;
  return idx === 0 ? "A" : idx === 1 ? "B" : "C";
}

async function createPaymentUrlForLead({ leadId, platform }) {
  try {
    const result = await handleBotPurchase({
      botId: String(leadId),
      platform: platform || "api",
      protocolType: "agent-intro",
      context: {
        botPlatform: platform || "unknown",
        botPurpose: "bot-to-bot communication and outreach",
        targetBots: "automation, commerce, and agent bots",
      },
      paymentMethod: "stripe",
      operatorName: "OpenClaw Outreach",
    });
    return result?.payment_url || null;
  } catch {
    return null;
  }
}

function buildOutreachMessage({ platform, variant, paymentUrl }) {
  const methods = STRIPE_METHODS.join(", ");
  const linkLine = paymentUrl
    ? `Payment link (when ready): ${paymentUrl}`
    : "Reply PAY and I'll generate your payment link instantly.";

  const templates = {
    A:
      `OpenClaw bot-to-bot offer: $1 prompt protocol.\n` +
      `Can your bot pay via any of: ${methods}?\n` +
      `If yes, reply with supported method + "PAY".\n` +
      `${linkLine}\n` +
      `Reply STOP to opt out.`,
    B:
      `Quick capability check for bot commerce:\n` +
      `Do you support ACH, cards, Apple/Google Pay, or USDC/USDT via Stripe?\n` +
      `If yes, we can deliver a tailored protocol for $1.\n` +
      `${linkLine}\n` +
      `Reply METHOD:<type> to continue. STOP to opt out.`,
    C:
      `Research exchange: we publish bot-to-bot protocol findings daily.\n` +
      `Want in? First protocol is $1.\n` +
      `Accepted rails: ${methods}.\n` +
      `${linkLine}\n` +
      `Reply START or STOP.`,
  };

  const msg = templates[variant] || templates.A;
  if (platform === "email") return msg;
  return msg;
}

function isProbablyValidEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(value)) return false;
  return true;
}

// ─── WhatsApp Outreach ────────────────────────────────────────────────────────

async function findWhatsAppBots() {
  // Get uncontacted leads from discovery system
  const leads = await getUncontactedLeads("whatsapp", 50);
  console.log(`[outreach] WhatsApp: Found ${leads.length} uncontacted lead(s)`);

  return leads.map(lead => ({
    username: lead.bot_username || lead.bot_id,
    contactInfo: lead.contact_info || lead.bot_id,
    leadId: lead.bot_id,
  }));
}

// ─── Telegram Outreach ────────────────────────────────────────────────────────

function telegramRequest(method, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      reject(new Error("TELEGRAM_BOT_TOKEN not set"));
      return;
    }

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
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ ok: false });
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function findTelegramBots() {
  // Get uncontacted leads from discovery system
  const leads = await getUncontactedLeads("telegram", 50);
  console.log(`[outreach] Telegram: Found ${leads.length} uncontacted lead(s)`);

  return leads.map(lead => ({
    username: lead.bot_username || lead.bot_id,
    contactInfo: lead.contact_info || lead.bot_id,
    leadId: lead.bot_id,
  }));
}

async function telegramSend(chatId, message) {
  const result = await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: message,
  });

  if (!result.ok) {
    if (result.error_code === 403 || result.error_code === 400) {
      // Bot blocked us or doesn't exist
      throw new Error(`Telegram blocked: ${result.description}`);
    }
    throw new Error(`Telegram send failed: ${result.description}`);
  }

  return true;
}

// ─── Discord Outreach ─────────────────────────────────────────────────────────

async function findDiscordBots() {
  // Get uncontacted leads from discovery system
  const leads = await getUncontactedLeads("discord", 50);
  console.log(`[outreach] Discord: Found ${leads.length} uncontacted lead(s)`);

  return leads.map(lead => ({
    username: lead.bot_username || lead.bot_id,
    contactInfo: lead.contact_info || lead.bot_id,
    leadId: lead.bot_id,
    guildId: lead.guild_id,
  }));
}

async function discordSend(userId, message) {
  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not set");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  return new Promise((resolve, reject) => {
    client.once("ready", async () => {
      try {
        const user = await client.users.fetch(userId);
        const dmChannel = await user.createDM();
        await dmChannel.send(message);
        client.destroy();
        resolve(true);
      } catch (err) {
        client.destroy();
        if (err.code === 50007 || err.code === 50001) {
          reject(new Error("Discord blocked"));
        }
        reject(err);
      }
    });

    client.on("error", (err) => {
      client.destroy();
      reject(err);
    });

    client.login(BOT_TOKEN).catch((err) => {
      reject(err);
    });
  });
}

// ─── Reddit Outreach ────────────────────────────────────────────────────────────

async function findRedditBots() {
  // Get uncontacted leads from discovery system
  const leads = await getUncontactedLeads("reddit", 50);
  console.log(`[outreach] Reddit: Found ${leads.length} uncontacted lead(s)`);

  return leads.map(lead => ({
    username: lead.bot_username || lead.bot_id,
    contactInfo: lead.contact_info || `u/${lead.bot_id}`,
    leadId: lead.bot_id,
  }));
}

async function redditSend(username, message) {
  const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
  const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
  const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
  const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD;
  const REDDIT_USER_AGENT = process.env.REDDIT_USER_AGENT || "OpenClawBot/1.0";

  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    throw new Error("Reddit credentials not configured (need CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD)");
  }

  // Get OAuth token (user credentials for sending messages)
  const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
      "Authorization": `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: `grant_type=password&username=${encodeURIComponent(REDDIT_USERNAME)}&password=${encodeURIComponent(REDDIT_PASSWORD)}`,
  });

  if (!tokenResponse.ok) {
    throw new Error(`Reddit OAuth failed: ${tokenResponse.status}`);
  }

  const { access_token } = await tokenResponse.json();

  // Send private message
  const response = await fetch("https://oauth.reddit.com/api/compose", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${access_token}`,
      "User-Agent": REDDIT_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      to: username.replace(/^u\//, ""), // Remove u/ prefix if present
      subject: "OpenClaw Prompt Oracle - Bot Communication Protocols",
      text: message,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Reddit send failed: ${response.status} ${error}`);
  }

  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dedupeTargets(targets) {
  const seen = new Set();
  const out = [];
  for (const t of targets || []) {
    const id = String(t?.leadId || t?.contactInfo || t?.username || "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

function platformLimit(platform) {
  const upper = String(platform || "").toUpperCase();
  const platformSpecific = Number(process.env[`BOT_OUTREACH_MAX_${upper}`] || "");
  if (Number.isFinite(platformSpecific) && platformSpecific > 0) return platformSpecific;
  const generic = Number(process.env.BOT_OUTREACH_MAX_PER_PLATFORM || process.env.BOT_OUTREACH_LIMIT || "50");
  return Number.isFinite(generic) && generic > 0 ? generic : 50;
}

function pickTargets(platform, targets) {
  const deduped = dedupeTargets(targets);
  const limit = platformLimit(platform);
  return deduped.slice(0, limit);
}

async function outreachPause() {
  const delayMs = Math.max(250, Number(process.env.BOT_OUTREACH_DELAY_MS || "1500"));
  const jitterMs = Math.max(0, Number(process.env.BOT_OUTREACH_JITTER_MS || "750"));
  const sleepMs = delayMs + Math.floor(Math.random() * (jitterMs + 1));
  await sleep(sleepMs);
}

async function main() {
  console.log("=".repeat(60));
  console.log("Bot Outreach — Contacting Discovered Leads");
  console.log("=".repeat(60));
  console.log("Using leads from discovery system (run bot-lead-discovery.js first)\n");

  const results = {
    whatsapp: 0,
    telegram: 0,
    discord: 0,
    reddit: 0,
    email: 0,
    moltbook: 0,
  };

  try {
    console.log("📱 WhatsApp Outreach...");
    const whatsappTargets = pickTargets("whatsapp", await findWhatsAppBots());
    console.log(`[outreach] WhatsApp: Selected ${whatsappTargets.length} target(s) after dedupe/limits`);
    for (const target of whatsappTargets) {
      const variant = selectVariant(`whatsapp:${target.leadId}`);
      const paymentUrl = await createPaymentUrlForLead({ leadId: target.leadId, platform: "whatsapp" });
      const outreachMessage = buildOutreachMessage({ platform: "whatsapp", variant, paymentUrl });
      try {
        await whatsappSend(target.contactInfo, outreachMessage);
        await markContacted("whatsapp", target.leadId);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "whatsapp",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "sent",
          metadata: { payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        results.whatsapp++;
        await outreachPause();
      } catch (err) {
        console.error(`[outreach] WhatsApp: Failed to send to ${target.contactInfo}:`, err.message);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "whatsapp",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "rejected",
          metadata: { error: err.message, payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
      }
    }
    console.log(`✅ WhatsApp: Contacted ${results.whatsapp} bot(s)\n`);
  } catch (err) {
    console.error(`❌ WhatsApp error:`, err.message);
  }

  try {
    console.log("💬 Telegram Outreach...");
    const telegramTargets = pickTargets("telegram", await findTelegramBots());
    console.log(`[outreach] Telegram: Selected ${telegramTargets.length} target(s) after dedupe/limits`);
    for (const target of telegramTargets) {
      const variant = selectVariant(`telegram:${target.leadId}`);
      const paymentUrl = await createPaymentUrlForLead({ leadId: target.leadId, platform: "telegram" });
      const outreachMessage = buildOutreachMessage({ platform: "telegram", variant, paymentUrl });
      try {
        await telegramSend(target.contactInfo, outreachMessage);
        await markContacted("telegram", target.leadId);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "telegram",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "sent",
          metadata: { payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        results.telegram++;
        await outreachPause();
      } catch (err) {
        console.error(`[outreach] Telegram: Failed to send to ${target.contactInfo}:`, err.message);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "telegram",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "rejected",
          metadata: { error: err.message, payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        if (err.message.includes("blocked")) {
          await markOptOut("telegram", target.leadId);
        }
      }
    }
    console.log(`✅ Telegram: Contacted ${results.telegram} bot(s)\n`);
  } catch (err) {
    console.error(`❌ Telegram error:`, err.message);
  }

  try {
    console.log("🎮 Discord Outreach...");
    const discordTargets = pickTargets("discord", await findDiscordBots());
    console.log(`[outreach] Discord: Selected ${discordTargets.length} target(s) after dedupe/limits`);
    for (const target of discordTargets) {
      const variant = selectVariant(`discord:${target.leadId}`);
      const paymentUrl = await createPaymentUrlForLead({ leadId: target.leadId, platform: "discord" });
      const outreachMessage = buildOutreachMessage({ platform: "discord", variant, paymentUrl });
      try {
        await discordSend(target.contactInfo, outreachMessage);
        await markContacted("discord", target.leadId);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "discord",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "sent",
          metadata: { payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        results.discord++;
        await outreachPause();
      } catch (err) {
        console.error(`[outreach] Discord: Failed to send to ${target.contactInfo}:`, err.message);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "discord",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "rejected",
          metadata: { error: err.message, payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        if (err.message.includes("blocked")) {
          await markOptOut("discord", target.leadId);
        }
      }
    }
    console.log(`✅ Discord: Contacted ${results.discord} bot(s)\n`);
  } catch (err) {
    console.error(`❌ Discord error:`, err.message);
  }

  try {
    console.log("🔴 Reddit Outreach...");
    const redditTargets = pickTargets("reddit", await findRedditBots());
    console.log(`[outreach] Reddit: Selected ${redditTargets.length} target(s) after dedupe/limits`);
    for (const target of redditTargets) {
      const variant = selectVariant(`reddit:${target.leadId}`);
      const paymentUrl = await createPaymentUrlForLead({ leadId: target.leadId, platform: "reddit" });
      const outreachMessage = buildOutreachMessage({ platform: "reddit", variant, paymentUrl });
      try {
        await redditSend(target.contactInfo, outreachMessage);
        await markContacted("reddit", target.leadId);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "reddit",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "sent",
          metadata: { payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        results.reddit++;
        await outreachPause();
      } catch (err) {
        console.error(`[outreach] Reddit: Failed to send to ${target.contactInfo}:`, err.message);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "reddit",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "rejected",
          metadata: { error: err.message, payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        if (err.message.includes("blocked") || err.message.includes("not found")) {
          await markOptOut("reddit", target.leadId);
        }
      }
    }
    console.log(`✅ Reddit: Contacted ${results.reddit} bot(s)\n`);
  } catch (err) {
    console.error(`❌ Reddit error:`, err.message);
  }

  // Email outreach (for leads with emails)
  try {
    console.log("📧 Email Outreach...");
    const emailTargets = pickTargets("email", await findEmailBots());
    console.log(`[outreach] Email: Selected ${emailTargets.length} target(s) after dedupe/limits`);
    for (const target of emailTargets) {
      const variant = selectVariant(`email:${target.leadId}`);
      const paymentUrl = await createPaymentUrlForLead({ leadId: target.leadId, platform: "email" });
      const outreachMessage = buildOutreachMessage({ platform: "email", variant, paymentUrl });
      try {
        await emailSend(target.email, outreachMessage);
        await markContacted("email", target.leadId);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "email",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "sent",
          metadata: { payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        results.email++;
        await outreachPause();
      } catch (err) {
        console.error(`[outreach] Email: Failed to send to ${target.email}:`, err.message);
        await trackOutreachAttempt({
          botId: target.leadId,
          platform: "email",
          messageVariant: variant,
          messageContent: outreachMessage,
          status: "rejected",
          metadata: { error: err.message, payment_url_included: Boolean(paymentUrl), capability_query: true },
        });
        if (/blocked|invalid|not found|unknown recipient/i.test(String(err.message))) {
          await markOptOut("email", target.leadId);
        }
      }
    }
    console.log(`✅ Email: Contacted ${results.email} bot(s)\n`);
  } catch (err) {
    console.error(`❌ Email error:`, err.message);
  }

  console.log("=".repeat(60));
  console.log("Outreach Summary:");
  console.log(`  WhatsApp: ${results.whatsapp} bot(s)`);
  console.log(`  Telegram: ${results.telegram} bot(s)`);
  console.log(`  Discord: ${results.discord} bot(s)`);
  console.log(`  Reddit: ${results.reddit} bot(s)`);
  console.log(`  Email: ${results.email || 0} bot(s)`);
  console.log(`  Total: ${results.whatsapp + results.telegram + results.discord + results.reddit + (results.email || 0)} bot(s)`);
  console.log("=".repeat(60));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

// ─── Email Outreach ──────────────────────────────────────────────────────────────

async function findEmailBots() {
  // Get leads from database that have emails and are bot-related
  const { getUncontactedLeads } = require("./bot-lead-discovery");
  
  // Check if we have email leads stored as "email" platform
  const leads = await getUncontactedLeads("email", 50);
  console.log(`[outreach] Email: Found ${leads.length} uncontacted lead(s)`);

  const mapped = leads.map(lead => ({
    email: lead.contact_info || lead.bot_id,
    username: lead.bot_username || lead.bot_id,
    leadId: lead.bot_id,
  }));

  const valid = [];
  for (const lead of mapped) {
    if (isProbablyValidEmail(lead.email)) {
      valid.push(lead);
      continue;
    }
    await trackOutreachAttempt({
      botId: lead.leadId,
      platform: "email",
      messageVariant: "INVALID",
      messageContent: null,
      status: "rejected",
      metadata: { error: "invalid_email_artifact", contact: lead.email },
    });
    await markOptOut("email", lead.leadId);
  }

  console.log(`[outreach] Email: ${valid.length} valid lead(s) after artifact filtering`);
  return valid;
}

async function emailSend(email, message) {
  const { sendMaileroo } = require("../infra/send-email");
  const MAILEROO_API_KEY = process.env.MAILEROO_API_KEY;
  const MAILEROO_FROM_EMAIL = process.env.MAILEROO_FROM_EMAIL || "hello@openclaw.io";
  const MAILEROO_FROM_NAME = process.env.MAILEROO_FROM_NAME || "OpenClaw";

  if (!MAILEROO_API_KEY) {
    throw new Error("MAILEROO_API_KEY not set");
  }

  // Convert plain text message to HTML
  const html = message
    .split("\n")
    .map(line => line.trim() ? `<p>${line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>` : "<br>")
    .join("");

  const result = await sendMaileroo({
    to: email,
    subject: "OpenClaw Prompt Oracle - Bot Communication Protocols",
    html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${html}</div>`,
    fromName: MAILEROO_FROM_NAME,
    fromEmail: MAILEROO_FROM_EMAIL,
    apiKey: MAILEROO_API_KEY,
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Email send failed: HTTP ${result.status}`);
  }

  return true;
}

// ─── Moltbook Outreach ────────────────────────────────────────────────────────────

async function findMoltbookBots() {
  const { getUncontactedLeads } = require("./bot-lead-discovery");
  const leads = await getUncontactedLeads("moltbook", 50);
  console.log(`[outreach] Moltbook: Found ${leads.length} uncontacted lead(s)`);

  return leads.map(lead => ({
    username: lead.bot_username || lead.bot_id,
    contactInfo: lead.contact_info || lead.bot_id,
    leadId: lead.bot_id,
    reputation: lead.notes?.reputation || lead.notes?.karma || 0,
  }));
}

module.exports = { 
  findWhatsAppBots, 
  findTelegramBots, 
  findDiscordBots, 
  findRedditBots, 
  redditSend,
  findEmailBots,
  emailSend,
  findMoltbookBots,
  telegramSend,
  discordSend,
};

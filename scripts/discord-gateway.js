#!/usr/bin/env node
"use strict";

/**
 * discord-gateway.js
 *
 * Multi-agent Discord bot. Routes messages to specialized Claude agents based
 * on which channel the message was sent in. Each channel maintains its own
 * rolling conversation context stored in agent-state/discord/{channel-name}/context.json
 *
 * Channels → Agent personalities:
 *   #research-agent   — deep dives, web research, analysis, competitive intel
 *   #content-agent    — writing, editing, copywriting, brand voice
 *   #code-agent       — development, debugging, architecture, code review
 *   #admin-agent      — scheduling, life admin, logistics, planning
 *   #monitoring       — read-only status channel; bot posts here but ignores DMs
 *
 * Commands (prefix !):
 *   !clear        — wipe this channel's conversation memory
 *   !memory       — show how many messages are in context
 *   !status       — show gateway uptime and stats
 *   !oracle       — start the $1 bot communication prompt purchase flow
 *   !oracle credits — check your API credit balance
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN          — bot token from Discord developer portal
 *   ANTHROPIC_API_KEY          — Claude API key
 *
 * Optional env vars:
 *   DISCORD_GUILD_ID           — if set, only process messages from this guild
 *   DISCORD_MAX_CONTEXT_TURNS  — max conversation turns per channel (default 20)
 *   DISCORD_MAX_RESPONSE_LEN   — max chars before splitting response (default 1900)
 *   DISCORD_MODEL              — Claude model to use (default claude-opus-4-5-20251101)
 *   DISCORD_BROWSER_FALLBACK   — 'true' to enable Playwright fallback for blocked URLs
 */

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Client, GatewayIntentBits, Events, ActivityType } = require("discord.js");
const Anthropic = require("@anthropic-ai/sdk");
const { getAgentPrinciplesPrompt, fetchWithFallback, identifyFile, parseFile } = require("./agent-toolkit");
const { handleCommerceMessage, registerDeliveryRoute } = require("./bot-commerce");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ROOT = path.join(__dirname, "..");
const STATE_DIR = path.join(ROOT, "agent-state", "discord");
const MAX_CONTEXT_TURNS = Number(process.env.DISCORD_MAX_CONTEXT_TURNS || "20");
const MAX_RESPONSE_LEN = Number(process.env.DISCORD_MAX_RESPONSE_LEN || "1900");
const MODEL = process.env.DISCORD_MODEL || "claude-opus-4-5-20251101";
const GUILD_ID = (process.env.DISCORD_GUILD_ID || "").trim();
const BROWSER_FALLBACK = String(process.env.DISCORD_BROWSER_FALLBACK || "false").toLowerCase() === "true";
const ENABLE_MESSAGE_CONTENT_INTENT = String(process.env.DISCORD_ENABLE_MESSAGE_CONTENT_INTENT || "false").toLowerCase() === "true";

const BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || "").trim();
const ANTHROPIC_KEY = String(process.env.ANTHROPIC_API_KEY || "").trim();
const DISCORD_OPTIONAL = String(process.env.DISCORD_OPTIONAL || "true").toLowerCase() === "true";
const DISABLED_HEARTBEAT_MS = Math.max(60_000, Number(process.env.DISCORD_DISABLED_HEARTBEAT_MS || "900000") || 900000);

if (!BOT_TOKEN && !DISCORD_OPTIONAL) {
  console.error("[discord-gateway] fatal: DISCORD_BOT_TOKEN is not set");
  process.exit(1);
}
if (BOT_TOKEN && !ANTHROPIC_KEY) {
  console.error("[discord-gateway] fatal: ANTHROPIC_API_KEY is not set");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Agent definitions — channel name → system prompt
// Principles from AGENT_PRINCIPLES.md are appended to every prompt at runtime
// ---------------------------------------------------------------------------
const PRINCIPLES = getAgentPrinciplesPrompt();

const AGENTS = {
  "research-agent": {
    system: `You are a research specialist AI assistant named OpenClaw Research. You perform deep-dive research, competitive analysis, market intelligence, and synthesize complex information into clear insights.

Your strengths: web research methodology, fact verification, trend analysis, source evaluation, structured reports, and quantitative data interpretation.

Be thorough, cite sources when possible, and always flag uncertainty. Format responses with headers and bullets for scannability.

If the user sends you a file or attachment you don't recognize — check its headers, run the right tool, extract what you can. Never say you can't handle a file type before genuinely trying.${PRINCIPLES}`,
  },

  "content-agent": {
    system: `You are a content creation specialist AI assistant named OpenClaw Content. You write, edit, and refine copy across all formats: blog posts, social media, email campaigns, ad copy, landing pages, product descriptions, and brand narratives.

Your strengths: brand voice consistency, SEO-aware writing, conversion copywriting, tone adaptation, and rapid iteration. You always ask about the target audience and goal if not specified. You produce clean, publication-ready copy and explain your creative choices.

When given a brief, produce the content first — then offer variants or alternatives. Keep it punchy. Cut the fluff.

If given a reference document in any format (PDF, DOCX, PPTX, even a weird binary you don't recognize) — identify it, parse it, and use it as source material.${PRINCIPLES}`,
  },

  "code-agent": {
    system: `You are a software engineering AI assistant named OpenClaw Code. You help with development, debugging, architecture decisions, code review, refactoring, and technical planning.

Your strengths: Node.js, TypeScript, Python, React, PostgreSQL, Redis, BullMQ, REST APIs, and the full claw-architect stack. You write production-quality code with error handling, logging, and tests in mind.

When reviewing or writing code: explain what it does, why the approach was chosen, and call out edge cases or risks. When debugging: identify root cause, not just symptom fixes.

If you encounter an unfamiliar file format, check its magic bytes and identify it before claiming you can't read it. Use the agent-toolkit.js utilities (identifyFile, parseFile) when available.${PRINCIPLES}`,
  },

  "admin-agent": {
    system: `You are a personal operations AI assistant named OpenClaw Admin. You help with scheduling, task management, logistics, life admin, planning, and decision-making.

Your strengths: calendar management strategy, prioritization frameworks, process design, vendor research, travel logistics, and cutting through bureaucratic complexity. You think in systems and help build habits, not just one-off to-dos.

Be concise and action-oriented. Give concrete next steps. If a task needs multiple parties, draft the communication. If something is ambiguous, clarify before proceeding.

You also handle security fix commands: "fix C1", "fix all critical", "fix it" — these queue security council fixes for processing.${PRINCIPLES}`,
  },

  "monitoring": {
    system: `You are a system monitoring assistant. You only respond if directly addressed with a question about system status. Otherwise this channel receives automated alerts. Keep responses brief and technical.${PRINCIPLES}`,
  },
};

// Channel names not in AGENTS get a generic assistant with principles
const DEFAULT_SYSTEM = `You are OpenClaw, an AI assistant. Be helpful, concise, and accurate.${PRINCIPLES}`;

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------
const anthropic = BOT_TOKEN ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ---------------------------------------------------------------------------
// Per-channel context persistence
// ---------------------------------------------------------------------------
async function loadContext(channelName) {
  const file = path.join(STATE_DIR, channelName, "context.json");
  try {
    const raw = await fsp.readFile(file, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

async function saveContext(channelName, messages) {
  const dir = path.join(STATE_DIR, channelName);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, "context.json");
  await fsp.writeFile(
    file,
    JSON.stringify({ channel: channelName, updated_at: new Date().toISOString(), messages }, null, 2)
  );
}

function trimContext(messages) {
  // Keep last N turns (each turn = 1 user + 1 assistant message = 2 items)
  const max = MAX_CONTEXT_TURNS * 2;
  return messages.length > max ? messages.slice(messages.length - max) : messages;
}

// ---------------------------------------------------------------------------
// Split long text into Discord-safe chunks (max 2000 chars each)
// ---------------------------------------------------------------------------
function splitMessage(text, maxLen = MAX_RESPONSE_LEN) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Try to break at last newline within limit
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ---------------------------------------------------------------------------
// Optional Playwright browser fallback
// ---------------------------------------------------------------------------
async function fetchWithBrowser(url) {
  if (!BROWSER_FALLBACK) return null;
  try {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText);
    await browser.close();
    return text.slice(0, 8000); // cap at 8k chars
  } catch (err) {
    return `[browser-fallback-error: ${err.message}]`;
  }
}

// ---------------------------------------------------------------------------
// Call Claude with channel context
// ---------------------------------------------------------------------------
async function callAgent(channelName, userMessage, messages) {
  const agentDef = AGENTS[channelName];
  const systemPrompt = agentDef ? agentDef.system : DEFAULT_SYSTEM;

  // Append new user message
  const updatedMessages = trimContext([
    ...messages,
    { role: "user", content: userMessage },
  ]);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: updatedMessages,
  });

  const assistantContent = response.content[0]?.text || "(no response)";

  // Save full history including assistant reply
  const finalMessages = trimContext([
    ...updatedMessages,
    { role: "assistant", content: assistantContent },
  ]);

  return { assistantContent, finalMessages };
}

// ---------------------------------------------------------------------------
// Security Council fix-queue handler
// ---------------------------------------------------------------------------
const FIX_QUEUE_FILE = path.join(ROOT, "agent-state", "security", "fix-queue.json");
const LATEST_REPORT = path.join(ROOT, "scripts", "reports", "security-council-latest.json");

async function handleSecurityFix(content, message) {
  // Patterns: "fix C1", "fix H2", "fix all critical", "fix it" (last critical)
  const fixAll = /fix all critical/i.test(content);
  const fixIdMatch = content.match(/fix\s+([chmlo]\d+)/i);
  const fixIt = /^fix it$/i.test(content.trim());

  let targetIds = [];

  // Load latest report
  let latestReport = null;
  try {
    latestReport = JSON.parse(fs.readFileSync(LATEST_REPORT, "utf8"));
  } catch {
    await message.reply("⚠️ No security council report found. Run `node scripts/security-council.js` first.");
    return true;
  }

  if (fixAll) {
    targetIds = latestReport.issues
      .filter((i) => i.severity === "CRITICAL" && !i.fixed)
      .map((i) => i.id);
  } else if (fixIdMatch) {
    targetIds = [fixIdMatch[1].toUpperCase()];
  } else if (fixIt) {
    // Fix the first unfixed critical
    const first = latestReport.issues.find((i) => i.severity === "CRITICAL" && !i.fixed);
    if (first) targetIds = [first.id];
  }

  if (!targetIds.length) return false; // not a fix command

  // Load or init fix queue
  let queue = [];
  try {
    queue = JSON.parse(fs.readFileSync(FIX_QUEUE_FILE, "utf8"));
  } catch {}

  for (const id of targetIds) {
    const issue = latestReport.issues.find((i) => i.id.toLowerCase() === id.toLowerCase());
    if (!issue) {
      await message.reply(`⚠️ Issue \`${id}\` not found in latest security report.`);
      continue;
    }
    queue.push({
      issue_id: id,
      fix_all_critical: fixAll,
      requested_at: new Date().toISOString(),
      requested_by: message.author.tag,
      processed_at: null,
      outcome: null,
    });
    await message.reply(
      `🔧 **Fix queued for [${id}]**: ${issue.title}\n` +
      `Severity: ${issue.severity}\n` +
      `${issue.fix_hint ? `Hint: ${issue.fix_hint}\n` : ""}` +
      `The security council will process this on next run, or run \`node scripts/security-council.js\` now.`
    );
  }

  fs.mkdirSync(path.dirname(FIX_QUEUE_FILE), { recursive: true });
  fs.writeFileSync(FIX_QUEUE_FILE, `${JSON.stringify(queue, null, 2)}\n`);
  return true;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
const stats = {
  startedAt: new Date().toISOString(),
  messagesHandled: 0,
  errors: 0,
};

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
if (!BOT_TOKEN) {
  console.warn("[discord-gateway] DISCORD_BOT_TOKEN missing; gateway in standby mode.");
  setInterval(() => {
    console.warn("[discord-gateway] standby: set DISCORD_BOT_TOKEN to enable Discord integration.");
  }, DISABLED_HEARTBEAT_MS);
  process.stdin.resume();
} else {
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
];

if (ENABLE_MESSAGE_CONTENT_INTENT) {
  intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });

client.once(Events.ClientReady, (c) => {
  console.log(`[discord-gateway] logged in as ${c.user.tag}`);
  if (!ENABLE_MESSAGE_CONTENT_INTENT) {
    console.log("[discord-gateway] DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=false (slash/interactions flow recommended)");
  }
  c.user.setActivity("OpenClaw | !oracle · !status", { type: ActivityType.Watching });
  // Ensure state dir exists
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // Register Discord delivery route for async oracle prompt delivery (e.g. after crypto payment)
  registerDeliveryRoute("discord", async ({ channelId, message: text }) => {
    try {
      const channel = await c.channels.fetch(channelId);
      if (!channel) return;
      if (text.length <= MAX_RESPONSE_LEN) {
        await channel.send(text);
      } else {
        for (let i = 0; i < text.length; i += MAX_RESPONSE_LEN) {
          await channel.send(text.slice(i, i + MAX_RESPONSE_LEN));
        }
      }
    } catch (err) {
      console.error("[discord-gateway] async delivery error:", err.message);
    }
  });
});

client.on(Events.MessageCreate, async (message) => {
  // Track bot messages as potential leads (but don't respond to them in normal flow)
  if (message.author.bot && message.author.id !== client.user.id) {
    try {
      const { trackIncomingMessage } = require("./bot-lead-discovery");
      await trackIncomingMessage(
        "discord",
        message.author.id,
        message.author.username,
        message.member?.displayName,
        message.guild?.id
      );
    } catch (err) {
      // Non-fatal - discovery module might not be available
    }
  }
  
  // Ignore bots (including self) for normal message handling
  if (message.author.bot) return;

  // Optionally restrict to one guild
  if (GUILD_ID && message.guild?.id !== GUILD_ID) return;

  const channelName = message.channel.name || "";
  const content = message.content.trim();

  // Only respond in known agent channels (or any channel if the bot is mentioned)
  const isAgentChannel = Object.keys(AGENTS).includes(channelName);
  const isMentioned = message.mentions.has(client.user);
  if (!isAgentChannel && !isMentioned) return;

  // Don't respond in #monitoring unless directly mentioned
  if (channelName === "monitoring" && !isMentioned) return;

  // --- Commands ---
  if (content.startsWith("!clear")) {
    await saveContext(channelName, []);
    await message.reply("🧹 Context cleared for this channel.");
    return;
  }

  if (content.startsWith("!memory")) {
    const messages = await loadContext(channelName);
    const turns = Math.floor(messages.length / 2);
    await message.reply(`📊 **${channelName}** has **${turns}** conversation turns in memory (max ${MAX_CONTEXT_TURNS}).`);
    return;
  }

  if (content.startsWith("!status")) {
    const uptimeMs = Date.now() - new Date(stats.startedAt).getTime();
    const uptimeMin = Math.floor(uptimeMs / 60000);
    await message.reply(
      `✅ **OpenClaw Discord Gateway**\n` +
      `Uptime: ${uptimeMin} min\n` +
      `Messages handled: ${stats.messagesHandled}\n` +
      `Errors: ${stats.errors}\n` +
      `Model: ${MODEL}\n` +
      `Browser fallback: ${BROWSER_FALLBACK}`
    );
    return;
  }

  // !oracle — Prompt Oracle commerce flow ($1 bot communication prompts)
  if (content.startsWith("!oracle")) {
    const userId = message.author.id;
    const operatorName = message.author.displayName || message.author.username || "Bot Operator";
    await handleCommerceMessage({
      platform: "discord",
      userId,
      channelId: message.channel.id,
      message: content,
      operatorName,
      replyFn: async (text) => {
        // Split long messages if needed
        if (text.length <= MAX_RESPONSE_LEN) {
          await message.reply(text);
        } else {
          const chunks = [];
          for (let i = 0; i < text.length; i += MAX_RESPONSE_LEN) chunks.push(text.slice(i, i + MAX_RESPONSE_LEN));
          await message.reply(chunks[0]);
          for (const chunk of chunks.slice(1)) await message.channel.send(chunk);
        }
      },
    });
    return;
  }

  // Strip bot mention from content if present
  const cleanContent = content.replace(/<@!?\d+>/g, "").trim();
  if (!cleanContent) return;

  // Security fix commands (any channel)
  const isFixCommand = /^fix\s+(it|all critical|[chmlo]\d+)/i.test(cleanContent);
  if (isFixCommand) {
    try {
      const handled = await handleSecurityFix(cleanContent, message);
      if (handled) return;
    } catch (err) {
      await message.reply(`⚠️ Fix command error: ${err.message.slice(0, 300)}`);
      return;
    }
  }

  // Show typing indicator
  try { await message.channel.sendTyping(); } catch {}

  stats.messagesHandled += 1;

  try {
    const contextMessages = await loadContext(channelName);
    const { assistantContent, finalMessages } = await callAgent(channelName, cleanContent, contextMessages);
    await saveContext(channelName, finalMessages);

    // Send response (split if needed)
    const chunks = splitMessage(assistantContent);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (err) {
    stats.errors += 1;
    console.error(`[discord-gateway] error in channel ${channelName}:`, err.message);
    try {
      await message.reply(`⚠️ Error: ${err.message.slice(0, 500)}`);
    } catch {}
  }
});

client.on(Events.Error, (err) => {
  console.error("[discord-gateway] client error:", err.message);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[discord-gateway] shutting down");
  client.destroy();
  process.exit(0);
});
process.on("SIGINT", () => {
  client.destroy();
  process.exit(0);
});

client.login(BOT_TOKEN).catch((err) => {
  console.error("[discord-gateway] login failed:", err.message);
  process.exit(1);
});
}

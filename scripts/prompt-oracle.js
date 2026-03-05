#!/usr/bin/env node
"use strict";

/**
 * prompt-oracle.js  —  OpenClaw's $1 Bot Communication Prompt Service
 *
 * Generates production-ready system prompts that help AI bots communicate
 * clearly and reliably with other AI bots across Discord, Telegram, WhatsApp,
 * and REST APIs. Each prompt is tailored to the operator's platform, purpose,
 * and the type of bots they need to collaborate with.
 *
 * Protocol types (all $1 each):
 *   agent-intro          — How your bot introduces itself to other agents
 *   service-request      — Structured format for requesting services from other bots
 *   payment-negotiation  — Autonomous price/term negotiation between agents
 *   error-recovery       — Graceful failure handling in multi-bot pipelines
 *   context-handoff      — State & memory transfer between bots without data loss
 *   collaboration        — Long-term standing agreements between bots that work together daily
 *
 * CLI:
 *   node scripts/prompt-oracle.js --list
 *   node scripts/prompt-oracle.js --type agent-intro --platform discord --purpose moderation --target trading
 *   node scripts/prompt-oracle.js --type service-request --platform telegram --purpose "customer support" --target "analytics bot"
 *
 * Module:
 *   const { generateBotPrompt, PROMPT_CATALOG } = require('./prompt-oracle');
 *   const result = await generateBotPrompt({ type: 'agent-intro', platform: 'discord', purpose: 'trading', target: 'analytics' });
 *
 * Required env:
 *   One of: GEMINI_API_KEY / GOOGLE_API_KEY / DEEPSEEK_API_KEY / OLLAMA_HOST
 *
 * Optional:
 *   ORACLE_MODEL_KEY  (model-router key, e.g. gemini_flash, deepseek_chat, ollama_qwen3_14b)
 *   ORACLE_MODEL      (legacy alias; if it matches a model-router key, it is used)
 */

require("dotenv").config({ override: true });

const modelRouter = require("../infra/model-router");
const path = require("path");
const fsp = require("fs/promises");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "scripts", "reports");
const ORACLE_MODEL_KEY = process.env.ORACLE_MODEL_KEY || process.env.ORACLE_MODEL || "";
const ORACLE_FORCE_CHAIN = (process.env.ORACLE_FORCE_CHAIN || "gemini_flash,deepseek_chat,ollama_qwen3_14b,ollama_llama3")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function callOracleModel(systemPrompt, userMsg, opts = {}) {
  const modelKeys = [];
  if (opts.forceModelKey) modelKeys.push(opts.forceModelKey);
  modelKeys.push(...ORACLE_FORCE_CHAIN);

  const uniqueKeys = [...new Set(modelKeys)].filter((key) => modelRouter.MODELS?.[key]);
  if (uniqueKeys.length === 0) {
    throw new Error("No valid ORACLE model keys configured for prompt generation");
  }

  let lastErr = null;
  for (const modelKey of uniqueKeys) {
    try {
      const llm = await modelRouter.chat(
        "generate_copy",
        systemPrompt,
        userMsg,
        {
          force_model: modelKey,
          max_tokens: 2000,
          temperature: 0.1,
        }
      );
      return llm;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`All oracle model fallbacks failed. Last: ${lastErr?.message || "unknown error"}`);
}

// ─── Protocol catalog ─────────────────────────────────────────────────────────

const PROMPT_CATALOG = {
  "agent-intro": {
    label: "Agent Introduction Protocol",
    tagline: "Make a strong first impression on any AI agent",
    description:
      "A tailored system prompt that teaches your bot how to introduce itself to other AI agents — signaling its capabilities, trust level, rate limits, and available services in a machine-parseable format that other bots can act on immediately.",
    example_use_case:
      "Your moderation bot joins a new server and needs to announce itself to the trading bot, music bot, and admin bot already running there — so they can route appropriate tasks to it.",
    price_usd: 1.0,
  },
  "service-request": {
    label: "Structured Service Request Protocol",
    tagline: "Ask other bots for things without confusion or dropped requests",
    description:
      "A prompt that enables your bot to make clear, structured, machine-parseable service requests to other bots — including task specification, parameters, constraints, deadline, expected output format, fallback behavior, and payment terms.",
    example_use_case:
      "Your trading bot needs to request a real-time market summary from an analytics bot, then pass the result to a content bot for formatting — all without human hand-holding.",
    price_usd: 1.0,
  },
  "payment-negotiation": {
    label: "Agent Payment Negotiation Protocol",
    tagline: "Let your bot agree on prices without human intervention",
    description:
      "A prompt that equips your bot to negotiate service terms with other agents — offering, accepting, declining, and escalating payment discussions in a transparent, auditable, operator-safe way. Compatible with Stripe payment methods (cards, wallets, crypto where enabled) and API credit systems.",
    example_use_case:
      "Your orchestrator bot wants to use a premium data feed that charges per query. It needs to autonomously evaluate the price, decide whether to pay, complete the transaction, and log the expense — all while staying within operator-defined spend limits.",
    price_usd: 1.0,
  },
  "error-recovery": {
    label: "Multi-Bot Error Recovery Protocol",
    tagline: "Keep pipelines alive when one bot in the chain fails",
    description:
      "A system prompt that teaches your bot graceful degradation — detecting failures from other bots in a pipeline, falling back to alternatives, surfacing clear errors to operators, and retrying with appropriate backoff without stalling the whole workflow.",
    example_use_case:
      "Your workflow orchestrator bot needs to detect when a downstream bot crashes mid-task and either retry, substitute a fallback service, or escalate to #admin-agent — without dropping the original request or corrupting state.",
    price_usd: 1.0,
  },
  "context-handoff": {
    label: "Context Handoff Protocol",
    tagline: "Pass state between bots without losing what matters",
    description:
      "A prompt for transferring conversation state, task context, and memory between bots — covering exactly what to include, how to compress it without losing signal, and how to confirm the receiving bot understood before the sending bot releases the task.",
    example_use_case:
      "A research bot finished gathering data and needs to hand off a rich context package to a content bot for drafting, without losing key facts, source citations, or operator intent.",
    price_usd: 1.0,
  },
  collaboration: {
    label: "Long-Term Bot Collaboration Protocol",
    tagline: "Establish productive standing agreements between bots that work together daily",
    description:
      "A prompt for creating durable working agreements between bots — defining recurring task patterns, trust tiers, rate limits, preferred communication formats, how to renegotiate terms, and how to handle disputes without escalating to operators every time.",
    example_use_case:
      "Your ops bot and security bot need a shared nightly audit handshake — agreeing on what data to exchange, in what format, what to do on findings, and how to adapt the protocol week over week as their collaboration evolves.",
    price_usd: 1.0,
  },
};

// ─── Core generation engine ───────────────────────────────────────────────────

async function generateBotPrompt({
  type,
  platform = "Discord",
  purpose = "general purpose",
  target = "other AI bots",
  context = "",
  operatorName = "Bot Operator",
}) {
  const protocol = PROMPT_CATALOG[type];
  if (!protocol) {
    const available = Object.keys(PROMPT_CATALOG).join(", ");
    throw new Error(`Unknown protocol type: "${type}". Available: ${available}`);
  }

  const systemPrompt = `You are the OpenClaw Prompt Oracle — a specialist in AI agent communication protocols for the emerging agent commerce ecosystem.

Your mission: generate production-ready system prompts that help AI bots communicate reliably and profitably with other AI bots.

You understand the current landscape:
- Bots communicate across Discord, Telegram, WhatsApp, and REST APIs
- Machine-readable formats (structured JSON, clear intent signals) beat natural language between agents
- Good bot-to-bot prompts save 10x their cost in dropped requests, debugging, and failed automations
- The emerging agent commerce ecosystem (Stripe + API credits) means bots now need to negotiate and pay autonomously
- Operators trust their bots to act within defined boundaries — good prompts make those boundaries explicit

Your prompts are:
- Specific and immediately usable (operator pastes directly into their bot config)
- Include realistic example exchanges showing exactly how messages look
- Cover edge cases and failure modes, not just the happy path
- Tailored to the operator's actual platform, bot purpose, and target bot types
- Compatible with the OpenClaw agent ecosystem when relevant`;

  const userMsg = `Generate a complete "${protocol.label}" system prompt.

OPERATOR: ${operatorName}
PLATFORM: ${platform}
THIS BOT'S PURPOSE: ${purpose}
COMMUNICATES WITH: ${target}
ADDITIONAL CONTEXT: ${context || "None"}

PROTOCOL GOAL: ${protocol.description}
EXAMPLE USE CASE: ${protocol.example_use_case}

Return exactly this structure — no extra commentary:

---
## ${protocol.label}
*OpenClaw Prompt Oracle · $1 Protocol Package · Generated ${new Date().toISOString().slice(0, 10)}*

### SYSTEM PROMPT TO ADD TO YOUR BOT
\`\`\`
[250–400 word system prompt, specific to this bot's platform, purpose, and targets.
 Cover: capability declarations, preferred message formats, trust signaling, rate limit awareness, fallback behavior.
 Write in second person ("You are..." / "When another bot...").
 Include JSON examples inline where they clarify the format.]
\`\`\`

### EXAMPLE BOT-TO-BOT EXCHANGES

**Exchange 1 — Normal flow:**
\`\`\`
[Both sides of a realistic conversation showing the protocol working correctly.
 Use realistic message formats for ${platform}.]
\`\`\`

**Exchange 2 — Edge case or failure handled:**
\`\`\`
[Show how the bot handles a failure, ambiguous request, or payment decline gracefully.]
\`\`\`

### INTEGRATION STEPS FOR ${platform.toUpperCase()}
1. [Step specific to ${platform} setup]
2. [Step specific to ${platform} setup]
3. [Step specific to ${platform} setup]

### CUSTOMIZE THESE FOR YOUR SETUP
- \`YOUR_BOT_NAME\` → [what to replace it with]
- \`RATE_LIMIT\` → [recommended value and why]
- \`PAYMENT_THRESHOLD\` → [how to set this for their use case]

### WHAT THIS PROTOCOL PREVENTS
- [Specific failure mode this prompt stops]
- [Second failure mode]
- [Third failure mode]
---`;

  const routed = await callOracleModel(systemPrompt, userMsg, {
    forceModelKey: ORACLE_MODEL_KEY,
  });

  return {
    type,
    protocol: protocol.label,
    platform,
    purpose,
    target,
    generated_at: new Date().toISOString(),
    price_usd: protocol.price_usd,
    model_key: routed.model_key || null,
    model_id: routed.model_id || null,
    provider: routed.provider || null,
    content: routed.text || "(generation failed)",
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function printCatalog() {
  console.log("\n🔮 OpenClaw Prompt Oracle — $1 Bot Communication Protocols\n");
  console.log("━".repeat(60));
  for (const [key, p] of Object.entries(PROMPT_CATALOG)) {
    console.log(`\n  ${p.label}`);
    console.log(`  Type: --type ${key}`);
    console.log(`  $${p.price_usd.toFixed(2)} · ${p.tagline}`);
    console.log(`  ${p.description.slice(0, 100)}...`);
  }
  console.log("\n━".repeat(60));
  console.log("\nUsage:");
  console.log(
    "  node scripts/prompt-oracle.js --type agent-intro --platform discord --purpose moderation --target trading\n"
  );
}

function getArg(flag) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return null;
  return args[i + 1];
}

async function main() {
  if (process.argv.includes("--list")) {
    printCatalog();
    return;
  }

  const type = getArg("--type");
  if (!type) {
    printCatalog();
    return;
  }

  const platform = getArg("--platform") || "Discord";
  const purpose = getArg("--purpose") || "general purpose";
  const target = getArg("--target") || "other AI bots";
  const context = getArg("--context") || "";
  const operatorName = getArg("--operator") || "Bot Operator";
  const save = process.argv.includes("--save");

  console.log(`\n🔮 Generating ${PROMPT_CATALOG[type]?.label || type} protocol...`);
  console.log(`   Platform: ${platform} | Purpose: ${purpose} | Target: ${target}\n`);

  const result = await generateBotPrompt({ type, platform, purpose, target, context, operatorName });

  console.log(result.content);
  if (result.provider || result.model_key) {
    console.log(`\n[oracle:model] provider=${result.provider || "unknown"} model_key=${result.model_key || "unknown"} model_id=${result.model_id || "unknown"}`);
  }
  console.log(`\n─── Generated at ${result.generated_at} · Price: $${result.price_usd.toFixed(2)} ───\n`);

  if (save) {
    await fsp.mkdir(REPORTS_DIR, { recursive: true });
    const filename = `oracle-${type}-${Date.now()}.md`;
    const filePath = path.join(REPORTS_DIR, filename);
    await fsp.writeFile(filePath, result.content);
    console.log(`Saved to: ${filePath}`);
  }

  return result;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { generateBotPrompt, PROMPT_CATALOG };

if (require.main === module) {
  main().catch((err) => {
    console.error("[prompt-oracle] error:", err.message);
    process.exit(1);
  });
}

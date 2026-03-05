#!/usr/bin/env node
"use strict";

/**
 * bot-commerce-api.js — Bot-to-Bot Commerce API
 * 
 * Enables autonomous agents to purchase prompts programmatically
 * 
 * Payment methods:
 * 1. API Credits (pre-purchased) - instant, zero friction
 * 2. Stripe (USD, USDC, cards) - for human operators
 * 3. Crypto Wallets (future) - for fully autonomous agents
 * 
 * Usage:
 *   POST /api/bot/purchase
 *   {
 *     "botId": "bot_123",
 *     "platform": "discord",
 *     "protocolType": "agent-intro",
 *     "context": {
 *       "botPlatform": "Discord",
 *       "botPurpose": "trading signals",
 *       "targetBots": "analytics bots"
 *     },
 *     "paymentMethod": "credits" | "stripe" | "crypto"
 *   }
 */

require("dotenv").config({ override: true });

const http = require("http");
const { generateBotPrompt, PROMPT_CATALOG } = require("./prompt-oracle");
const {
  createCharge,
  getCredits,
  deductCredit,
  addCredits,
} = require("./payment-router");

const PORT = parseInt(process.env.BOT_COMMERCE_API_PORT || "3032", 10);
const HOST = process.env.BOT_COMMERCE_API_HOST || "127.0.0.1";
const API_KEY = process.env.BOT_COMMERCE_API_KEY; // Optional API key for authentication

// ─── Bot Purchase Handler ──────────────────────────────────────────────────────

async function handleBotPurchase(payload) {
  const {
    botId,
    platform = "api",
    protocolType = "agent-intro",
    context = {},
    paymentMethod = "credits", // "credits" | "stripe" | "crypto"
    operatorName = "Autonomous Agent",
  } = payload;

  // Validate protocol type
  if (!PROMPT_CATALOG[protocolType]) {
    throw new Error(`Invalid protocol type: ${protocolType}. Available: ${Object.keys(PROMPT_CATALOG).join(", ")}`);
  }

  // Handle payment based on method
  let chargeResult;
  let prompt;

  if (paymentMethod === "credits") {
    // API Credits - instant, zero friction
    try {
      await deductCredit(botId);
      chargeResult = {
        chargeId: `credits_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        rail: "credits",
        immediately_paid: true,
      };
    } catch (err) {
      if (err.message.includes("Insufficient credits")) {
        return {
          success: false,
          error: "insufficient_credits",
          message: err.message,
          credits: await getCredits(botId),
        };
      }
      throw err;
    }
  } else if (paymentMethod === "stripe") {
    // Stripe payment - generates payment link
    chargeResult = await createCharge({
      rail: "stripe",
      userId: botId,
      platform,
      protocolType,
      operatorName,
      context,
    });
    
    // For Stripe, return payment URL (bot needs to complete payment)
    return {
      success: true,
      requires_payment: true,
      payment_url: chargeResult.payment_url,
      charge_id: chargeResult.chargeId,
      expires_at: chargeResult.expires_at,
      message: "Payment link generated. Complete payment to receive prompt.",
    };
  } else if (paymentMethod === "crypto") {
    // Crypto wallet payment (future - requires crypto wallet integration)
    return {
      success: false,
      error: "not_implemented",
      message: "Crypto wallet payments not yet implemented. Use 'credits' or 'stripe'.",
    };
  } else {
    throw new Error(`Invalid payment method: ${paymentMethod}. Use 'credits', 'stripe', or 'crypto'`);
  }

  // Generate prompt if payment successful
  if (chargeResult.immediately_paid) {
    prompt = await generateBotPrompt({
      protocolType,
      botPlatform: context.botPlatform || "API",
      botPurpose: context.botPurpose || "general purpose",
      targetBots: context.targetBots || "other AI bots",
    });

    return {
      success: true,
      prompt: {
        content: prompt.content,
        protocol_type: protocolType,
        generated_at: new Date().toISOString(),
      },
      payment: {
        method: "credits",
        charge_id: chargeResult.chargeId,
        paid: true,
      },
      credits: await getCredits(botId),
    };
  }

  return {
    success: true,
    requires_payment: true,
    charge_id: chargeResult.chargeId,
    message: "Payment required to receive prompt",
  };
}

// ─── API Server ────────────────────────────────────────────────────────────────

function startAPIServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse request
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

        // Health check
        if (url.pathname === "/health" || url.pathname === "/healthz" || url.pathname === "/api/bot/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", service: "bot-commerce-api" }));
          return;
        }

        // Bot purchase endpoint
        if (url.pathname === "/api/bot/purchase" && req.method === "POST") {
          // Optional API key authentication
          if (API_KEY) {
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "unauthorized", message: "Invalid API key" }));
              return;
            }
          }

          const payload = JSON.parse(body);
          const result = await handleBotPurchase(payload);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }

        // Get credits balance
        if (url.pathname === "/api/bot/credits" && req.method === "GET") {
          const botId = url.searchParams.get("botId");
          if (!botId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "missing_bot_id" }));
            return;
          }

          const credits = await getCredits(botId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(credits));
          return;
        }

        // Add credits (admin only - for pre-purchasing credits for bots)
        if (url.pathname === "/api/bot/credits/add" && req.method === "POST") {
          if (API_KEY) {
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "unauthorized" }));
              return;
            }
          }

          const { botId, amount } = JSON.parse(body);
          if (!botId || !amount) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "missing_bot_id_or_amount" }));
            return;
          }

          const credits = await addCredits(botId, amount);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, credits }));
          return;
        }

        // List available protocols
        if (url.pathname === "/api/bot/protocols" && req.method === "GET") {
          const protocols = Object.entries(PROMPT_CATALOG).map(([id, protocol]) => ({
            id,
            label: protocol.label,
            description: protocol.description,
          }));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ protocols }));
          return;
        }

        // 404
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      } catch (err) {
        console.error("[bot-commerce-api] error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error", message: err.message }));
      }
    });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${PORT} is already in use!`);
      console.error(`\n   Kill the process using port ${PORT}:`);
      console.error(`   kill $(lsof -ti :${PORT})`);
      console.error(`\n   Or use a different port:`);
      console.error(`   BOT_COMMERCE_API_PORT=${PORT + 1} node scripts/bot-commerce-api.js\n`);
      process.exit(1);
    } else {
      console.error("[bot-commerce-api] server error:", err.message);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[bot-commerce-api] Bot-to-Bot Commerce API running on port ${PORT}`);
    console.log(`[bot-commerce-api] Endpoints:`);
    console.log(`  POST /api/bot/purchase - Purchase a prompt`);
    console.log(`  GET  /api/bot/credits?botId=<id> - Check credit balance`);
    console.log(`  POST /api/bot/credits/add - Add credits (admin)`);
    console.log(`  GET  /api/bot/protocols - List available protocols`);
    console.log(`  GET  /api/bot/health - Health check`);
    if (API_KEY) {
      console.log(`[bot-commerce-api] API key authentication: ENABLED`);
    }
  });

  return server;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  startAPIServer();
}

module.exports = { handleBotPurchase, startAPIServer };

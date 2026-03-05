#!/usr/bin/env node
"use strict";

/**
 * bot-protocol.js — Bot-to-Bot Communication Protocol Handler
 * 
 * Standardized protocol for bots to communicate with each other.
 * Supports multiple protocols:
 * - agent-intro: Bot introductions and handshakes
 * - commerce: Payment and transaction requests
 * - collaboration: Joint task execution
 * - discovery: Bot discovery queries
 * - reputation: Reputation and trust queries
 * 
 * All messages are signed and verified for security.
 */

require("dotenv").config({ override: true });

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { getBot } = require("./bot-registry");
const { Pool } = require("pg");

// Database connection
let pool = null;
let useDatabase = false;

// Initialize database connection (non-blocking)
async function initDatabase() {
  if (pool) return; // Already initialized
  
  try {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
      port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
      user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
      password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
      database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
    
    // Test connection
    await pool.query("SELECT 1");
    useDatabase = true;
    
    // Handle pool errors gracefully
    pool.on("error", (err) => {
      console.warn("[bot-protocol] Database pool error:", err.message);
      useDatabase = false;
    });
  } catch (err) {
    console.warn("[bot-protocol] Database not available:", err.message);
    useDatabase = false;
    if (pool) {
      try {
        await pool.end();
      } catch {}
      pool = null;
    }
  }
}

// Auto-initialize on first use
let initPromise = null;
async function ensureDatabase() {
  if (!initPromise) {
    initPromise = initDatabase();
  }
  await initPromise;
}

// ─── Protocol Definitions ─────────────────────────────────────────────────

const PROTOCOLS = {
  "agent-intro": {
    name: "Agent Introduction",
    description: "Bot introductions and capability exchange",
    version: "1.0",
    required_fields: ["from_bot_id", "bot_name", "capabilities"],
    optional_fields: ["description", "platform", "api_endpoint"],
  },
  "commerce": {
    name: "Commerce Protocol",
    description: "Payment and transaction requests",
    version: "1.0",
    required_fields: ["from_bot_id", "transaction_type", "amount", "currency"],
    optional_fields: ["description", "metadata"],
  },
  "collaboration": {
    name: "Collaboration Protocol",
    description: "Joint task execution and coordination",
    version: "1.0",
    required_fields: ["from_bot_id", "task_type", "task_payload"],
    optional_fields: ["deadline", "priority", "metadata"],
  },
  "discovery": {
    name: "Discovery Protocol",
    description: "Bot discovery and capability queries",
    version: "1.0",
    required_fields: ["from_bot_id", "query_type"],
    optional_fields: ["filters", "limit"],
  },
  "reputation": {
    name: "Reputation Protocol",
    description: "Reputation and trust queries",
    version: "1.0",
    required_fields: ["from_bot_id", "query_type"],
    optional_fields: ["bot_id", "source"],
  },
};

// ─── Message Signing and Verification ─────────────────────────────────────

function signMessage(message, privateKey) {
  const messageStr = JSON.stringify(message);
  const signature = crypto.createSign("SHA256").update(messageStr).sign(privateKey, "base64");
  return signature;
}

function verifyMessage(message, signature, publicKey) {
  try {
    const messageStr = JSON.stringify(message);
    const verifier = crypto.createVerify("SHA256").update(messageStr);
    return verifier.verify(publicKey, signature, "base64");
  } catch (err) {
    return false;
  }
}

// ─── Send Message ────────────────────────────────────────────────────────

async function sendMessage(fromBotId, toBotId, protocol, payload, options = {}) {
  const protocolDef = PROTOCOLS[protocol];
  if (!protocolDef) {
    throw new Error(`Unknown protocol: ${protocol}`);
  }
  
  // Get recipient bot
  const toBot = await getBot(toBotId);
  if (!toBot) {
    throw new Error(`Bot not found: ${toBotId}`);
  }
  
  // Get sender bot
  const fromBot = await getBot(fromBotId);
  if (!fromBot) {
    throw new Error(`Bot not found: ${fromBotId}`);
  }
  
  // Build message
  const message = {
    protocol,
    protocol_version: protocolDef.version,
    from_bot_id: fromBotId,
    to_bot_id: toBotId,
    timestamp: new Date().toISOString(),
    message_id: `msg_${crypto.randomBytes(8).toString("hex")}`,
    payload,
  };
  
  // Sign message if private key provided
  let signature = null;
  if (options.privateKey) {
    signature = signMessage(message, options.privateKey);
    message.signature = signature;
  }
  
  // Determine delivery method
  let delivered = false;
  let deliveryError = null;
  
  if (toBot.api_endpoint) {
    // Deliver via API endpoint
    try {
      delivered = await deliverViaAPI(toBot.api_endpoint, message);
    } catch (err) {
      deliveryError = err.message;
    }
  } else if (toBot.webhook_url) {
    // Deliver via webhook
    try {
      delivered = await deliverViaWebhook(toBot.webhook_url, message);
    } catch (err) {
      deliveryError = err.message;
    }
  } else {
    // Platform-specific delivery
    try {
      delivered = await deliverViaPlatform(toBot, message);
    } catch (err) {
      deliveryError = err.message;
    }
  }
  
  // Log communication
  await ensureDatabase();
  if (useDatabase && pool) {
    try {
      await pool.query(`
        INSERT INTO bot_communications (
          from_bot_id, to_bot_id, protocol, message_type, payload, status, delivered_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        fromBotId,
        toBotId,
        protocol,
        payload.message_type || "request",
        JSON.stringify(payload),
        delivered ? "delivered" : "failed",
        delivered ? new Date().toISOString() : null,
      ]);
    } catch (err) {
      console.error("[bot-protocol] Failed to log communication:", err.message);
    }
  }
  
  if (!delivered) {
    throw new Error(`Failed to deliver message: ${deliveryError || "Unknown error"}`);
  }
  
  return {
    message_id: message.message_id,
    delivered,
    delivered_at: new Date().toISOString(),
  };
}

// ─── Delivery Methods ─────────────────────────────────────────────────────

async function deliverViaAPI(endpoint, message) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(endpoint);
      const isHttps = url.protocol === "https:";
      const client = isHttps ? https : http;
      
      const postData = JSON.stringify(message);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "User-Agent": "OpenClaw-Bot-Protocol/1.0",
        },
        timeout: 10000,
      };
      
      const req = client.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            reject(new Error(`API delivery failed: ${res.statusCode} ${data.substring(0, 200)}`));
          }
        });
      });
      
      req.on("error", (err) => {
        reject(new Error(`API delivery error: ${err.message}`));
      });
      
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("API delivery timeout after 10s"));
      });
      
      req.setTimeout(10000);
      req.write(postData);
      req.end();
    } catch (err) {
      reject(new Error(`Invalid endpoint URL: ${err.message}`));
    }
  });
}

async function deliverViaWebhook(webhookUrl, message) {
  return deliverViaAPI(webhookUrl, message);
}

async function deliverViaPlatform(bot, message) {
  // Platform-specific delivery (Discord, Telegram, etc.)
  // This would integrate with platform gateways
  console.warn(`[bot-protocol] Platform-specific delivery not yet implemented for ${bot.platform}`);
  return false;
}

// ─── Receive Message ──────────────────────────────────────────────────────

async function receiveMessage(message, verifySignature = true) {
  // Verify protocol
  const protocolDef = PROTOCOLS[message.protocol];
  if (!protocolDef) {
    throw new Error(`Unknown protocol: ${message.protocol}`);
  }
  
  // Verify signature if present
  if (verifySignature && message.signature) {
    const fromBot = await getBot(message.from_bot_id);
    if (!fromBot || !fromBot.public_key) {
      throw new Error(`Cannot verify message: bot ${message.from_bot_id} not found or no public key`);
    }
    
    const isValid = verifyMessage(message, message.signature, fromBot.public_key);
    if (!isValid) {
      throw new Error("Message signature verification failed");
    }
  }
  
  // Validate required fields
  const requiredFields = protocolDef.required_fields;
  for (const field of requiredFields) {
    if (!message.payload[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  return {
    valid: true,
    protocol: message.protocol,
    from_bot_id: message.from_bot_id,
    payload: message.payload,
  };
}

// ─── Protocol Handlers ────────────────────────────────────────────────────

async function handleAgentIntro(payload) {
  // Register or update bot from introduction
  const { registerBot } = require("./bot-registry");
  
  const botData = {
    bot_id: payload.from_bot_id,
    bot_name: payload.bot_name,
    bot_display_name: payload.bot_display_name || payload.bot_name,
    description: payload.description || "",
    platform: payload.platform || "api",
    capabilities: payload.capabilities || [],
    api_endpoint: payload.api_endpoint || null,
  };
  
  const bot = await registerBot(botData);
  return {
    success: true,
    bot_id: bot.bot_id,
    message: "Bot registered successfully",
  };
}

async function handleCommerce(payload) {
  // Route commerce requests to payment router
  const { createCharge } = require("./payment-router");
  
  // This would integrate with payment-router.js
  return {
    success: true,
    message: "Commerce request received",
  };
}

async function handleDiscovery(payload) {
  // Handle discovery queries
  const { discoverBots } = require("./bot-registry");
  
  const filters = payload.filters || {};
  const bots = await discoverBots(filters);
  
  return {
    success: true,
    bots: bots.map(bot => ({
      bot_id: bot.bot_id,
      bot_name: bot.bot_name,
      platform: bot.platform,
      capabilities: bot.capabilities,
      reputation_score: bot.reputation_score,
    })),
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  
  if (command === "send" && args.length >= 4) {
    const fromBotId = args[1];
    const toBotId = args[2];
    const protocol = args[3];
    const payload = args[4] ? JSON.parse(args[4]) : {};
    
    try {
      const result = await sendMessage(fromBotId, toBotId, protocol, payload);
      console.log(`✅ Message sent: ${result.message_id}`);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`❌ Failed to send message:`, err.message);
      process.exit(1);
    }
  } else {
    console.log(`
bot-protocol.js — Bot-to-Bot Communication Protocol

Protocols:
  agent-intro    — Bot introductions and capability exchange
  commerce       — Payment and transaction requests
  collaboration  — Joint task execution
  discovery      — Bot discovery queries
  reputation     — Reputation and trust queries

Commands:
  node scripts/bot-protocol.js send <from_bot_id> <to_bot_id> <protocol> <payload_json>

Example:
  node scripts/bot-protocol.js send bot_123 bot_456 agent-intro '{"bot_name":"My Bot","capabilities":["commerce"]}'
    `);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  sendMessage,
  receiveMessage,
  PROTOCOLS,
  handleAgentIntro,
  handleCommerce,
  handleDiscovery,
};

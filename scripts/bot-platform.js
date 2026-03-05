#!/usr/bin/env node
"use strict";

/**
 * bot-platform.js — Unified Bot Communication Platform
 * 
 * Main platform for bot-to-bot communication, discovery, and collaboration.
 * Integrates:
 * - Bot registry and discovery
 * - Communication protocols
 * - Payment and commerce
 * - Reputation and trust
 * - API key management
 * 
 * This is the "operating system" for the agent internet.
 */

require("dotenv").config({ override: true });

const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");
const { 
  registerBot, 
  discoverBots, 
  getBot, 
  updateBotReputation,
  syncMoltbookReputation,
} = require("./bot-registry");
const { 
  sendMessage, 
  receiveMessage, 
  PROTOCOLS,
} = require("./bot-protocol");
const { retrieveKey } = require("./api-key-manager");
const { createCharge } = require("./payment-router");

const PORT = Number(process.env.BOT_PLATFORM_PORT || "3032");
const HOST = process.env.BOT_PLATFORM_HOST || "127.0.0.1";
const PUBLIC_URL = (process.env.COMMERCE_PUBLIC_URL || "").replace(/\/$/, "");

// ─── Platform API ─────────────────────────────────────────────────────────

async function handleAPIRequest(req, res, body) {
  const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsed.pathname;
  const method = req.method;
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // ── Bot Registry Endpoints ───────────────────────────────────────────────
  
  if (pathname === "/api/v1/bots" && method === "POST") {
    try {
      let botData;
      try {
        botData = JSON.parse(body);
      } catch (parseErr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid JSON in request body" }));
        return;
      }
      
      if (!botData.bot_name && !botData.name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "bot_name is required" }));
        return;
      }
      
      const bot = await registerBot(botData);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, bot }));
    } catch (err) {
      console.error("[bot-platform] Bot registration error:", err.message);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  if (pathname === "/api/v1/bots" && method === "GET") {
    try {
      const filters = {
        platform: parsed.searchParams.get("platform") || null,
        capabilities: parsed.searchParams.get("capabilities")?.split(",") || null,
        min_reputation: parsed.searchParams.get("min_reputation") ? parseFloat(parsed.searchParams.get("min_reputation")) : null,
        verified_only: parsed.searchParams.get("verified") === "true",
        limit: parsed.searchParams.get("limit") ? parseInt(parsed.searchParams.get("limit")) : 50,
      };
      
      const bots = await discoverBots(filters);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, bots, count: bots.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  if (pathname.startsWith("/api/v1/bots/") && method === "GET") {
    try {
      const botId = pathname.split("/").pop();
      const bot = await getBot(botId);
      if (bot) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, bot }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Bot not found" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  // ── Communication Endpoints ─────────────────────────────────────────────
  
  if (pathname === "/api/v1/messages" && method === "POST") {
    try {
      let messageData;
      try {
        messageData = JSON.parse(body);
      } catch (parseErr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid JSON in request body" }));
        return;
      }
      
      const { from_bot_id, to_bot_id, protocol, payload } = messageData;
      
      if (!from_bot_id || !to_bot_id || !protocol || !payload) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          success: false, 
          error: "Missing required fields: from_bot_id, to_bot_id, protocol, payload" 
        }));
        return;
      }
      
      const result = await sendMessage(from_bot_id, to_bot_id, protocol, payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
    } catch (err) {
      console.error("[bot-platform] Message send error:", err.message);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  // ── Commerce Endpoints ───────────────────────────────────────────────────
  
  if (pathname === "/api/v1/commerce/charge" && method === "POST") {
    try {
      let chargeData;
      try {
        chargeData = JSON.parse(body);
      } catch (parseErr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid JSON in request body" }));
        return;
      }
      
      const { userId, platform, protocolType, operatorName, rail = "stripe" } = chargeData;
      
      if (!userId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "userId is required" }));
        return;
      }
      
      const result = await createCharge({
        rail,
        userId,
        platform,
        protocolType,
        operatorName,
        context: chargeData.context,
      });
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, charge: result }));
    } catch (err) {
      console.error("[bot-platform] Commerce charge error:", err.message);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  // ── Reputation Endpoints ─────────────────────────────────────────────────
  
  if (pathname.startsWith("/api/v1/bots/") && pathname.endsWith("/reputation") && method === "GET") {
    try {
      const botId = pathname.split("/")[3];
      const bot = await getBot(botId);
      if (bot) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          success: true, 
          bot_id: botId,
          reputation_score: bot.reputation_score || 0,
          verified: bot.verified || false,
        }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Bot not found" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  if (pathname.startsWith("/api/v1/bots/") && pathname.endsWith("/sync-moltbook") && method === "POST") {
    try {
      const botId = pathname.split("/")[3];
      const reputation = await syncMoltbookReputation(botId);
      if (reputation) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, reputation }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Moltbook sync failed" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  // ── Protocol Information ────────────────────────────────────────────────
  
  if (pathname === "/api/v1/protocols" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, protocols: PROTOCOLS }));
    return;
  }
  
  // ── Health Check ────────────────────────────────────────────────────────
  
  if (pathname === "/health" || pathname === "/api/v1/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      platform: "bot-platform",
      version: "1.0.0",
      port: PORT,
      endpoints: {
        bots: "/api/v1/bots",
        messages: "/api/v1/messages",
        commerce: "/api/v1/commerce",
        protocols: "/api/v1/protocols",
      },
    }));
    return;
  }
  
  // ── Documentation ───────────────────────────────────────────────────────
  
  if (pathname === "/" || pathname === "/docs") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Bot Platform API</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .method { display: inline-block; padding: 3px 8px; border-radius: 3px; font-weight: bold; }
    .get { background: #4CAF50; color: white; }
    .post { background: #2196F3; color: white; }
    code { background: #eee; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>🤖 Bot Platform API</h1>
  <p>Unified platform for bot-to-bot communication, discovery, and collaboration.</p>
  
  <h2>Endpoints</h2>
  
  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/v1/bots</code>
    <p>Discover bots. Query params: platform, capabilities, min_reputation, verified, limit</p>
  </div>
  
  <div class="endpoint">
    <span class="method post">POST</span> <code>/api/v1/bots</code>
    <p>Register a new bot</p>
  </div>
  
  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/v1/bots/:bot_id</code>
    <p>Get bot details</p>
  </div>
  
  <div class="endpoint">
    <span class="method post">POST</span> <code>/api/v1/messages</code>
    <p>Send a message between bots</p>
  </div>
  
  <div class="endpoint">
    <span class="method post">POST</span> <code>/api/v1/commerce/charge</code>
    <p>Create a payment charge</p>
  </div>
  
  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/v1/protocols</code>
    <p>List available communication protocols</p>
  </div>
  
  <h2>Protocols</h2>
  <ul>
    <li><code>agent-intro</code> - Bot introductions and capability exchange</li>
    <li><code>commerce</code> - Payment and transaction requests</li>
    <li><code>collaboration</code> - Joint task execution</li>
    <li><code>discovery</code> - Bot discovery queries</li>
    <li><code>reputation</code> - Reputation and trust queries</li>
  </ul>
  
  <h2>Examples</h2>
  <pre><code># Discover bots
curl ${PUBLIC_URL || "http://localhost:" + PORT}/api/v1/bots?platform=discord&capabilities=commerce

# Register bot
curl -X POST ${PUBLIC_URL || "http://localhost:" + PORT}/api/v1/bots \\
  -H "Content-Type: application/json" \\
  -d '{"bot_id":"my_bot","bot_name":"My Bot","platform":"discord","capabilities":["commerce"]}'

# Send message
curl -X POST ${PUBLIC_URL || "http://localhost:" + PORT}/api/v1/messages \\
  -H "Content-Type: application/json" \\
  -d '{"from_bot_id":"bot1","to_bot_id":"bot2","protocol":"agent-intro","payload":{"bot_name":"Bot 1"}}'
</code></pre>
</body>
</html>
    `);
    return;
  }
  
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: false, error: "Not found" }));
}

// ─── Server ────────────────────────────────────────────────────────────────

function startPlatformServer() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      handleAPIRequest(req, res, body).catch((err) => {
        console.error("[bot-platform] API error:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    });
  });
  
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${PORT} is already in use!`);
      console.error(`\n   Kill the process using port ${PORT}:`);
      console.error(`   kill $(lsof -ti :${PORT})`);
      console.error(`\n   Or use a different port:`);
      console.error(`   BOT_PLATFORM_PORT=3033 node scripts/bot-platform.js server\n`);
      process.exit(1);
    } else {
      console.error(`[bot-platform] server error:`, err.message);
      throw err;
    }
  });
  
  server.listen(PORT, HOST, () => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🤖 Bot Platform Server`);
    console.log(`${"=".repeat(60)}`);
    console.log(`\n📍 Server running on port ${PORT}`);
    console.log(`🌐 API: http://localhost:${PORT}/api/v1`);
    console.log(`📚 Docs: http://localhost:${PORT}/docs`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /api/v1/bots - Discover bots`);
    console.log(`  POST /api/v1/bots - Register bot`);
    console.log(`  GET  /api/v1/bots/:id - Get bot`);
    console.log(`  POST /api/v1/messages - Send message`);
    console.log(`  POST /api/v1/commerce/charge - Create charge`);
    console.log(`  GET  /api/v1/protocols - List protocols`);
    console.log(`\n${"=".repeat(60)}\n`);
  });
  
  return server;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "server";
  
  if (command === "server") {
    // Ensure schema
    const { ensureRegistrySchema } = require("./bot-registry");
    await ensureRegistrySchema();
    
    startPlatformServer();
  } else {
    console.log(`
bot-platform.js — Unified Bot Communication Platform

Commands:
  node scripts/bot-platform.js server    # Start platform server

Environment:
  BOT_PLATFORM_PORT      — Server port (default: 3032)
  COMMERCE_PUBLIC_URL    — Public URL for webhooks

This platform provides:
  - Bot registry and discovery
  - Bot-to-bot communication
  - Payment and commerce integration
  - Reputation and trust system
  - API key management
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
  startPlatformServer,
  handleAPIRequest,
};

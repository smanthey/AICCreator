#!/usr/bin/env node
"use strict";

/**
 * bot-outreach-coordinator.js — Multi-Channel Outreach Coordinator
 * 
 * Coordinates aggressive outreach across all channels:
 * - Discord
 * - Telegram
 * - WhatsApp
 * - Moltbook
 * 
 * Uses optimized messages, tracks results, and continuously improves.
 * Goal: 100-300k credits in 3 months through aggressive outreach.
 */

require("dotenv").config({ override: true });

const { getHighPriorityTargets } = require("./bot-discovery-aggressive");
const { getOptimizedMessage, optimizeMessageForBot } = require("./bot-message-optimizer");
const { trackConversion } = require("./bot-conversion-tracker");
const { Pool } = require("pg");
const { getUncontactedLeads, markContacted } = require("./bot-lead-discovery");
const { whatsappSend } = require("./bot-commerce");

// Database connection
let pool = null;
let useDatabase = false;

async function initDatabase() {
  if (pool) return;
  
  try {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
      port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
      user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
      password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
      database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
      connectionTimeoutMillis: 5000,
    });
    
    await pool.query("SELECT 1");
    useDatabase = true;
    
    // Ensure outreach results table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_outreach_results (
        id UUID PRIMARY KEY,
        bot_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        message_variant TEXT NOT NULL,
        message_content TEXT,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        responded_at TIMESTAMPTZ,
        converted_at TIMESTAMPTZ,
        response_time_seconds INTEGER,
        conversion_value NUMERIC(10,2) DEFAULT 0,
        status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'opened', 'responded', 'converted', 'rejected', 'ignored')),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_outreach_bot_id ON bot_outreach_results(bot_id);
      CREATE INDEX IF NOT EXISTS idx_outreach_status ON bot_outreach_results(status);
      CREATE INDEX IF NOT EXISTS idx_outreach_variant ON bot_outreach_results(message_variant);
    `);
  } catch (err) {
    console.warn("[coordinator] Database not available:", err.message);
    useDatabase = false;
  }
}

// ─── Record Outreach ──────────────────────────────────────────────────────

async function recordOutreach(botId, platform, messageVariant, messageContent) {
  await initDatabase();
  
  if (useDatabase && pool) {
    try {
      await pool.query(`
        INSERT INTO bot_outreach_results (
          bot_id, platform, message_variant, message_content, status, sent_at
        ) VALUES ($1, $2, $3, $4, 'sent', NOW())
      `, [botId, platform, messageVariant, messageContent]);
    } catch (err) {
      console.error("[coordinator] Failed to record outreach:", err.message);
    }
  }
}

// ─── Send Outreach Message ────────────────────────────────────────────────

async function sendOutreachMessage(bot, platform) {
  // Get optimized message
  const botMetadata = {
    ...(bot.metadata || {}),
    platform: platform || bot.platform || "unknown",
  };
  const optimized = await optimizeMessageForBot(bot.bot_id, botMetadata);
  
  const message = optimized.content;
  const variant = optimized.variant;
  
  let sent = false;
  
  try {
    if (platform === "discord") {
        // Use existing Discord outreach
        const { discordSend } = require("./bot-outreach");
        sent = await discordSend(bot.bot_id, message);
      } else if (platform === "telegram") {
        // Use existing Telegram outreach
        const { telegramSend } = require("./bot-outreach");
        sent = await telegramSend(bot.bot_id, message);
      } else if (platform === "whatsapp") {
        // Use WhatsApp sending
        sent = await whatsappSend(bot.bot_id, message);
      } else if (platform === "moltbook") {
        // Moltbook messaging (if API available)
        console.warn("[coordinator] Moltbook messaging not yet implemented");
        sent = false;
      } else {
        console.warn(`[coordinator] Unknown platform: ${platform}`);
        sent = false;
      }
    
    if (sent) {
      // Record outreach
      await recordOutreach(bot.bot_id, platform, variant, message);
      
      // Mark as contacted
      if (useDatabase && pool) {
        await pool.query(`
          UPDATE bot_discovery_targets
          SET status = 'contacted', contacted_at = NOW()
          WHERE bot_id = $1
        `, [bot.bot_id]);
      }
      
      await markContacted(platform, bot.bot_id);
    }
  } catch (err) {
    console.error(`[coordinator] Failed to send to ${bot.bot_id}:`, err.message);
  }
  
  return sent;
}

// ─── Run Aggressive Outreach ───────────────────────────────────────────────

async function runAggressiveOutreach(targetCount = 100) {
  await initDatabase();
  
  console.log("=".repeat(60));
  console.log("🚀 Aggressive Outreach Campaign");
  console.log("=".repeat(60));
  console.log(`Target: ${targetCount} bots`);
  console.log();
  
  // Get high priority targets
  const targets = await getHighPriorityTargets(targetCount);
  
  console.log(`Found ${targets.length} high-priority targets`);
  
  // Group by platform
  const byPlatform = {};
  for (const target of targets) {
    const platform = target.platform || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = [];
    }
    byPlatform[platform].push(target);
  }
  
  console.log("\nBy Platform:");
  for (const [platform, bots] of Object.entries(byPlatform)) {
    console.log(`  ${platform}: ${bots.length} bots`);
  }
  
  // Send messages
  console.log("\n📤 Sending messages...");
  let sent = 0;
  let failed = 0;
  
  for (const [platform, bots] of Object.entries(byPlatform)) {
    console.log(`\n${platform}:`);
    for (const bot of bots) {
      try {
        const success = await sendOutreachMessage(bot, platform);
        if (success) {
          sent++;
          process.stdout.write(".");
        } else {
          failed++;
          process.stdout.write("x");
        }
        
        // Rate limiting
        await sleep(1000); // 1 second between messages
      } catch (err) {
        failed++;
        console.error(`\n[coordinator] Error sending to ${bot.bot_id}:`, err.message);
      }
    }
  }
  
  console.log(`\n\n✅ Outreach complete:`);
  console.log(`   Sent: ${sent}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Success rate: ${((sent / (sent + failed)) * 100).toFixed(1)}%`);
  
  return { sent, failed, total: sent + failed };
}

// ─── Daily Outreach Routine ───────────────────────────────────────────────

async function runDailyOutreach() {
  // Calculate target based on goal
  // Need ~50 conversions/day for 100k in 3 months
  // With 5% conversion rate, need ~1000 contacts/day
  // But start with 100-200 and scale up
  
  const targetCount = parseInt(process.env.DAILY_OUTREACH_TARGET || "200");
  
  console.log(`Running daily outreach for ${targetCount} bots...`);
  
  const result = await runAggressiveOutreach(targetCount);
  
  // Schedule next run
  console.log("\n📅 Next outreach scheduled for tomorrow");
  
  return result;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "outreach";
  
  if (command === "outreach") {
    const count = args[1] ? parseInt(args[1]) : 100;
    await runAggressiveOutreach(count);
  } else if (command === "daily") {
    await runDailyOutreach();
  } else {
    console.log(`
bot-outreach-coordinator.js — Multi-Channel Outreach Coordinator

Commands:
  node scripts/bot-outreach-coordinator.js outreach [count]  # Run outreach campaign
  node scripts/bot-outreach-coordinator.js daily            # Run daily outreach routine

Goal: 100-300k credits in 3 months through aggressive outreach
    `);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  runAggressiveOutreach,
  runDailyOutreach,
  sendOutreachMessage,
};

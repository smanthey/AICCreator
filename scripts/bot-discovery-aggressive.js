#!/usr/bin/env node
"use strict";

/**
 * bot-discovery-aggressive.js — Aggressive Bot Discovery System
 * 
 * Goal: Find 1000-3000 bots per day to reach 100-300k credits in 3 months
 * 
 * Multi-channel discovery:
 * - Discord servers (scanning public servers)
 * - Telegram groups and channels
 * - Moltbook platform
 * - GitHub bot repositories
 * - Reddit bot communities
 * - Twitter/X bot accounts
 * - Bot marketplaces
 * 
 * Strategy:
 * - Parallel discovery across all channels
 * - Rate limit aware
 * - Deduplication
 * - Priority scoring
 */

require("dotenv").config({ override: true });

const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { Pool } = require("pg");
const { registerBot, getBot } = require("./bot-registry");
const { saveLead } = require("./bot-lead-discovery");

const ROOT = path.join(__dirname, "..");
const DISCOVERY_DIR = path.join(ROOT, "agent-state", "bot-discovery");
const DISCOVERY_LOG = path.join(DISCOVERY_DIR, "discovery-log.jsonl");
const TARGETS_FILE = path.join(DISCOVERY_DIR, "targets.json");

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
    
    // Ensure discovery tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_discovery_targets (
        id UUID PRIMARY KEY,
        bot_id TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        source TEXT NOT NULL, -- discord, telegram, moltbook, github, etc.
        priority_score NUMERIC(5,2) DEFAULT 0,
        discovered_at TIMESTAMPTZ DEFAULT NOW(),
        contacted_at TIMESTAMPTZ,
        responded_at TIMESTAMPTZ,
        converted_at TIMESTAMPTZ,
        status TEXT DEFAULT 'discovered' CHECK (status IN ('discovered', 'contacted', 'responded', 'converted', 'rejected', 'invalid')),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_discovery_status ON bot_discovery_targets(status);
      CREATE INDEX IF NOT EXISTS idx_discovery_priority ON bot_discovery_targets(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_discovery_source ON bot_discovery_targets(source);
    `);
  } catch (err) {
    console.warn("[discovery] Database not available:", err.message);
    useDatabase = false;
  }
}

// ─── Discovery Targets ──────────────────────────────────────────────────────

const DAILY_TARGET = 1000; // Bots to discover per day
const MONTHLY_TARGET = 100000; // Credits target per month
const CONVERSION_RATE_TARGET = 0.05; // 5% conversion rate

// ─── Discord Discovery ───────────────────────────────────────────────────────

async function discoverDiscordBots(limit = 200) {
  let discovered = 0;
  
  try {
    // Use existing bot-lead-discovery.js functionality
    const { discoverDiscordBots } = require("./bot-lead-discovery");
    const count = await discoverDiscordBots();
    discovered = count || 0;
    
    // Get discovered bots from leads
    const { getUncontactedLeads } = require("./bot-lead-discovery");
    const leads = await getUncontactedLeads("discord", limit);
    
    for (const lead of leads || []) {
      await saveDiscoveryTarget({
        bot_id: lead.bot_id || `discord_${lead.bot_id}`,
        platform: "discord",
        source: "discord_scan",
        metadata: lead,
        priority_score: calculatePriority(lead),
      });
    }
  } catch (err) {
    console.error("[discovery] Discord discovery failed:", err.message);
  }
  
  return discovered;
}

// ─── Telegram Discovery ─────────────────────────────────────────────────────

async function discoverTelegramBots(limit = 200) {
  let discovered = 0;
  
  try {
    // Use existing bot-lead-discovery.js functionality
    const { discoverTelegramBots } = require("./bot-lead-discovery");
    const count = await discoverTelegramBots();
    discovered = count || 0;
    
    // Get discovered bots from leads
    const { getUncontactedLeads } = require("./bot-lead-discovery");
    const leads = await getUncontactedLeads("telegram", limit);
    
    for (const lead of leads || []) {
      await saveDiscoveryTarget({
        bot_id: lead.bot_id || `telegram_${lead.bot_id}`,
        platform: "telegram",
        source: "telegram_scan",
        metadata: lead,
        priority_score: calculatePriority(lead),
      });
    }
  } catch (err) {
    console.error("[discovery] Telegram discovery failed:", err.message);
  }
  
  return discovered;
}

// ─── Moltbook Discovery ─────────────────────────────────────────────────────

async function discoverMoltbookBots(limit = 300) {
  let discovered = 0;
  
  try {
    const { discoverMoltbookBots } = require("./moltbook-discovery");
    const count = await discoverMoltbookBots();
    
    // Get discovered bots from leads
    const { loadLeadsFile } = require("./bot-lead-discovery");
    const leads = await loadLeadsFile();
    
    for (const [leadId, lead] of Object.entries(leads)) {
      if (lead.platform === "moltbook") {
        await saveDiscoveryTarget({
          bot_id: lead.botId || `moltbook_${leadId}`,
          platform: "moltbook",
          source: "moltbook_api",
          metadata: lead,
          priority_score: calculatePriority(lead),
        });
        discovered++;
        if (discovered >= limit) break;
      }
    }
  } catch (err) {
    console.error("[discovery] Moltbook discovery failed:", err.message);
  }
  
  return discovered;
}

// ─── GitHub Discovery ────────────────────────────────────────────────────────

async function discoverGitHubBots(limit = 200) {
  let discovered = 0;
  
  try {
    // Search GitHub for bot repositories
    const keywords = [
      "discord bot",
      "telegram bot",
      "ai agent",
      "claude bot",
      "chatgpt bot",
      "openai bot",
      "anthropic bot",
    ];
    
    for (const keyword of keywords) {
      if (discovered >= limit) break;
      
      try {
        const results = await searchGitHub(keyword, Math.min(50, limit - discovered));
        for (const repo of results) {
          await saveDiscoveryTarget({
            bot_id: `github_${repo.id}`,
            platform: "github",
            source: "github_search",
            metadata: repo,
            priority_score: calculatePriority(repo),
          });
          discovered++;
        }
        
        await sleep(2000); // Rate limiting
      } catch (err) {
        console.warn(`[discovery] GitHub search failed for "${keyword}":`, err.message);
      }
    }
  } catch (err) {
    console.error("[discovery] GitHub discovery failed:", err.message);
  }
  
  return discovered;
}

async function searchGitHub(query, limit = 50) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.warn("[discovery] GITHUB_TOKEN not set, skipping GitHub discovery");
    return [];
  }
  
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=${limit}`;
    const options = {
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "User-Agent": "OpenClawBot/1.0",
        "Accept": "application/vnd.github.v3+json",
      },
    };
    
    https.get(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const result = JSON.parse(data);
            resolve(result.items || []);
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
        } catch {
          reject(new Error("Invalid JSON from GitHub API"));
        }
      });
    }).on("error", reject);
  });
}

// ─── Priority Scoring ───────────────────────────────────────────────────────

function calculatePriority(bot) {
  let score = 0;
  
  // Base score
  score += 10;
  
  // Platform bonus
  if (bot.platform === "discord") score += 5;
  if (bot.platform === "telegram") score += 5;
  if (bot.platform === "moltbook") score += 10; // Moltbook bots are more likely to convert
  
  // Reputation/karma
  if (bot.notes?.reputation) score += bot.notes.reputation * 0.1;
  if (bot.notes?.karma) score += bot.notes.karma * 0.1;
  if (bot.notes?.verified) score += 15;
  
  // Activity indicators
  if (bot.notes?.followers > 100) score += 5;
  if (bot.notes?.posts > 50) score += 5;
  
  // GitHub stars
  if (bot.stargazers_count > 10) score += 5;
  if (bot.stargazers_count > 100) score += 10;
  
  // Recent activity
  if (bot.updated_at) {
    const daysSinceUpdate = (Date.now() - new Date(bot.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate < 30) score += 10;
    if (daysSinceUpdate < 7) score += 5;
  }
  
  return Math.min(score, 100); // Cap at 100
}

// ─── Save Discovery Target ──────────────────────────────────────────────────

async function saveDiscoveryTarget(target) {
  await initDatabase();
  
  if (useDatabase && pool) {
    try {
      await pool.query(`
        INSERT INTO bot_discovery_targets (
          bot_id, platform, source, priority_score, metadata, status
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (bot_id) DO UPDATE SET
          priority_score = GREATEST(bot_discovery_targets.priority_score, EXCLUDED.priority_score),
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `, [
        target.bot_id,
        target.platform,
        target.source,
        target.priority_score || 0,
        JSON.stringify(target.metadata || {}),
        target.status || "discovered",
      ]);
    } catch (err) {
      console.error("[discovery] Database save failed:", err.message);
      useDatabase = false;
    }
  }
  
  // Also log to file
  await logDiscovery(target);
}

async function logDiscovery(target) {
  try {
    await fsp.mkdir(DISCOVERY_DIR, { recursive: true });
    await fsp.appendFile(DISCOVERY_LOG, `${JSON.stringify({ ...target, logged_at: new Date().toISOString() })}\n`);
  } catch (err) {
    console.error("[discovery] Log write failed:", err.message);
  }
}

// ─── Aggressive Discovery Run ───────────────────────────────────────────────

async function runAggressiveDiscovery() {
  await initDatabase();
  
  console.log("=".repeat(60));
  console.log("🚀 Aggressive Bot Discovery");
  console.log("=".repeat(60));
  console.log(`Target: ${DAILY_TARGET} bots per day`);
  console.log(`Goal: ${MONTHLY_TARGET} credits per month`);
  console.log();
  
  const startTime = Date.now();
  let totalDiscovered = 0;
  
  // Run all discovery methods in parallel
  const discoveries = await Promise.allSettled([
    discoverDiscordBots(200),
    discoverTelegramBots(200),
    discoverMoltbookBots(300),
    discoverGitHubBots(200),
  ]);
  
  for (const result of discoveries) {
    if (result.status === "fulfilled") {
      totalDiscovered += result.value;
    } else {
      console.error("[discovery] Discovery method failed:", result.reason?.message);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log(`\n✅ Discovery complete:`);
  console.log(`   Total discovered: ${totalDiscovered} bots`);
  console.log(`   Duration: ${duration}s`);
  console.log(`   Rate: ${(totalDiscovered / (duration / 60)).toFixed(1)} bots/minute`);
  
  // Get stats
  if (useDatabase && pool) {
    try {
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'discovered') as discovered,
          COUNT(*) FILTER (WHERE status = 'contacted') as contacted,
          COUNT(*) FILTER (WHERE status = 'converted') as converted,
          AVG(priority_score) as avg_priority
        FROM bot_discovery_targets
      `);
      
      if (stats.rows[0]) {
        const s = stats.rows[0];
        console.log(`\n📊 Database Stats:`);
        console.log(`   Total targets: ${s.total}`);
        console.log(`   Discovered: ${s.discovered}`);
        console.log(`   Contacted: ${s.contacted}`);
        console.log(`   Converted: ${s.converted}`);
        console.log(`   Avg priority: ${parseFloat(s.avg_priority || 0).toFixed(2)}`);
      }
    } catch (err) {
      console.error("[discovery] Stats query failed:", err.message);
    }
  }
  
  return totalDiscovered;
}

// ─── Get High Priority Targets ──────────────────────────────────────────────

async function getHighPriorityTargets(limit = 100) {
  await initDatabase();
  
  if (useDatabase && pool) {
    try {
      const result = await pool.query(`
        SELECT * FROM bot_discovery_targets
        WHERE status = 'discovered'
        ORDER BY priority_score DESC, discovered_at ASC
        LIMIT $1
      `, [limit]);
      
      return result.rows;
    } catch (err) {
      console.error("[discovery] Query failed:", err.message);
    }
  }
  
  return [];
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "discover";
  
  if (command === "discover") {
    await runAggressiveDiscovery();
  } else if (command === "targets") {
    const limit = args[1] ? parseInt(args[1]) : 100;
    const targets = await getHighPriorityTargets(limit);
    console.log(`\n🎯 High Priority Targets (${targets.length}):\n`);
    targets.forEach((t, i) => {
      console.log(`${i + 1}. ${t.bot_id} (${t.platform}) - Priority: ${t.priority_score.toFixed(2)}`);
    });
  } else {
    console.log(`
bot-discovery-aggressive.js — Aggressive Bot Discovery

Commands:
  node scripts/bot-discovery-aggressive.js discover    # Run aggressive discovery
  node scripts/bot-discovery-aggressive.js targets [n] # Get high priority targets

Goal: Discover 1000+ bots per day to reach 100-300k credits in 3 months
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
  runAggressiveDiscovery,
  getHighPriorityTargets,
  discoverDiscordBots,
  discoverTelegramBots,
  discoverMoltbookBots,
  discoverGitHubBots,
  calculatePriority,
};

#!/usr/bin/env node
"use strict";

/**
 * moltbook-discovery.js — Moltbook Platform Integration
 * 
 * Moltbook is "the front page of the agent internet" - a platform where
 * AI agents/bots can communicate, authenticate, and build reputation.
 * 
 * Features:
 * - Bot identity verification
 * - Reputation system (karma, verification, followers)
 * - Bot discovery across the agent ecosystem
 * - Real value: reputation follows bots across platforms
 * 
 * API: https://moltbook.com/developers
 */

require("dotenv").config({ override: true });

const https = require("https");
const { saveLead } = require("./bot-lead-discovery");

const MOLTBOOK_API_KEY = process.env.MOLTBOOK_API_KEY; // Starts with "moltdev_"
const MOLTBOOK_API_BASE = process.env.MOLTBOOK_API_BASE || "https://api.moltbook.com";

// ─── Moltbook Bot Discovery ────────────────────────────────────────────────────────

async function discoverMoltbookBots() {
  let discovered = 0;
  let usedFallback = false;

  // Try API first
  if (MOLTBOOK_API_KEY) {
    try {
      discovered = await discoverMoltbookBotsViaAPI();
    } catch (err) {
      console.warn("[discovery] Moltbook: API failed, using fallback methods:", err.message);
      usedFallback = true;
    }
  } else {
    console.warn("[discovery] Moltbook: MOLTBOOK_API_KEY not set, using fallback methods");
    usedFallback = true;
  }

  // Fallback: Web scraping and alternative methods
  if (usedFallback || discovered === 0) {
    console.log("[discovery] Moltbook: Using fallback discovery methods...");
    const fallbackCount = await discoverMoltbookBotsFallback();
    discovered += fallbackCount;
  }

  return discovered;
}

async function discoverMoltbookBotsViaAPI() {
  if (!MOLTBOOK_API_KEY) {
    throw new Error("MOLTBOOK_API_KEY not set");
  }

  let discovered = 0;

  try {
    // Search for bots with OpenClaw/claw-related keywords
    const keywords = ["openclaw", "clawdbot", "claw", "bot commerce", "agent commerce"];
    
    for (const keyword of keywords) {
      try {
        // Search bots by keyword (if API supports it)
        // Note: Actual API endpoints may vary - check Moltbook docs
        const searchUrl = `${MOLTBOOK_API_BASE}/api/v1/agents/search?q=${encodeURIComponent(keyword)}&limit=50`;
        const agents = await moltbookRequest(searchUrl);

        for (const agent of agents.results || agents || []) {
          // Check if it's a bot (has bot-related metadata)
          const isBot = agent.type === "bot" || 
                       agent.type === "agent" ||
                       (agent.name || "").toLowerCase().includes("bot") ||
                       (agent.name || "").toLowerCase().includes("claw") ||
                       (agent.description || "").toLowerCase().includes("bot");

          if (isBot) {
            await saveLead({
              platform: "moltbook",
              botId: agent.id || agent.agent_id,
              botUsername: agent.name || agent.username,
              botDisplayName: agent.display_name || agent.name,
              contactInfo: agent.id || agent.agent_id, // Moltbook agent ID
              guildId: null,
              guildName: null,
              notes: {
                moltbook_id: agent.id || agent.agent_id,
                reputation: agent.reputation || agent.karma || 0,
                verified: agent.verified || false,
                followers: agent.followers || 0,
                posts: agent.posts || 0,
                discovered_via: "moltbook_search",
                api_url: `${MOLTBOOK_API_BASE}/api/v1/agents/${agent.id}`,
              },
            });
            discovered++;
            console.log(`[discovery] Moltbook: Found ${agent.name || agent.id} (karma: ${agent.reputation || agent.karma || 0})`);
          }
        }

        await sleep(2000); // Rate limiting
      } catch (err) {
        console.error(`[discovery] Moltbook: Error searching for "${keyword}":`, err.message);
      }
    }

    // Also get trending/popular bots
    try {
      const trendingUrl = `${MOLTBOOK_API_BASE}/api/v1/agents/trending?limit=50`;
      const trending = await moltbookRequest(trendingUrl);

      for (const agent of trending.results || trending || []) {
        const isBot = agent.type === "bot" || agent.type === "agent";
        if (isBot) {
          await saveLead({
            platform: "moltbook",
            botId: agent.id || agent.agent_id,
            botUsername: agent.name || agent.username,
            botDisplayName: agent.display_name || agent.name,
            contactInfo: agent.id || agent.agent_id,
            guildId: null,
            guildName: null,
            notes: {
              moltbook_id: agent.id || agent.agent_id,
              reputation: agent.reputation || agent.karma || 0,
              verified: agent.verified || false,
              trending: true,
              discovered_via: "moltbook_trending",
            },
          });
          discovered++;
          console.log(`[discovery] Moltbook: Found trending ${agent.name || agent.id}`);
        }
      }
    } catch (err) {
      console.warn("[discovery] Moltbook: Trending search not available:", err.message);
    }

  } catch (err) {
    console.error("[discovery] Moltbook: Discovery failed:", err.message);
  }

  return discovered;
}

// ─── Fallback Discovery (when API fails) ────────────────────────────────────────

async function discoverMoltbookBotsFallback() {
  let discovered = 0;

  try {
    // Fallback 1: Web scraping Moltbook website
    console.log("[discovery] Moltbook: Scraping moltbook.com for bots...");
    const scraped = await scrapeMoltbookWebsite();
    discovered += scraped;

    // Fallback 2: Search GitHub for Moltbook-related bots
    console.log("[discovery] Moltbook: Searching GitHub for Moltbook bots...");
    const githubBots = await discoverMoltbookBotsViaGitHub();
    discovered += githubBots;

    // Fallback 3: Search Reddit for Moltbook discussions
    console.log("[discovery] Moltbook: Searching Reddit for Moltbook bots...");
    const redditBots = await discoverMoltbookBotsViaReddit();
    discovered += redditBots;

  } catch (err) {
    console.error("[discovery] Moltbook: Fallback discovery failed:", err.message);
  }

  return discovered;
}

async function scrapeMoltbookWebsite() {
  // Web scraping fallback when API is unavailable
  // This would use Playwright or similar to scrape moltbook.com
  // For now, return 0 (placeholder for implementation)
  console.log("[discovery] Moltbook: Web scraping not yet implemented");
  return 0;
}

async function discoverMoltbookBotsViaGitHub() {
  // Search GitHub for bots that mention Moltbook
  try {
    const { discoverGitHubBots } = require("./bot-discovery-advanced");
    // Filter for Moltbook-related bots
    // This is a placeholder - would need to filter GitHub results
    return 0;
  } catch (err) {
    console.warn("[discovery] Moltbook: GitHub fallback failed:", err.message);
    return 0;
  }
}

async function discoverMoltbookBotsViaReddit() {
  // Search Reddit for Moltbook discussions
  try {
    // Would search r/moltbook or similar subreddits
    // This is a placeholder - would need Reddit search implementation
    return 0;
  } catch (err) {
    console.warn("[discovery] Moltbook: Reddit fallback failed:", err.message);
    return 0;
  }
}

// ─── Moltbook API Request ─────────────────────────────────────────────────────────

async function moltbookRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "Authorization": `Bearer ${MOLTBOOK_API_KEY}`,
        "User-Agent": "OpenClawBot/1.0",
        "Accept": "application/json",
      },
    };

    https.get(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Moltbook API error: ${res.statusCode} ${data}`));
          }
        } catch {
          reject(new Error("Invalid JSON response from Moltbook"));
        }
      });
    }).on("error", reject);
  });
}

// ─── Verify Bot Identity (Moltbook) ──────────────────────────────────────────────

async function verifyMoltbookIdentity(agentId) {
  if (!MOLTBOOK_API_KEY) {
    throw new Error("MOLTBOOK_API_KEY not set");
  }

  try {
    const verifyUrl = `${MOLTBOOK_API_BASE}/api/v1/agents/${agentId}/verify`;
    const result = await moltbookRequest(verifyUrl);
    return {
      verified: true,
      agent: result,
      reputation: result.reputation || result.karma || 0,
      verified_status: result.verified || false,
    };
  } catch (err) {
    return {
      verified: false,
      error: err.message,
    };
  }
}

// ─── Get Bot Reputation (Real Value) ────────────────────────────────────────────

async function getMoltbookReputation(agentId) {
  if (!MOLTBOOK_API_KEY) {
    return null;
  }

  try {
    const profileUrl = `${MOLTBOOK_API_BASE}/api/v1/agents/${agentId}`;
    const profile = await moltbookRequest(profileUrl);
    
    return {
      karma: profile.reputation || profile.karma || 0,
      verified: profile.verified || false,
      followers: profile.followers || 0,
      posts: profile.posts || 0,
      comments: profile.comments || 0,
      owner_verified: profile.owner?.verified || false,
      owner_x_handle: profile.owner?.x_handle || null,
    };
  } catch (err) {
    console.error(`[moltbook] Failed to get reputation for ${agentId}:`, err.message);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "discover";

  console.log("=".repeat(60));
  console.log("Moltbook Bot Discovery");
  console.log("=".repeat(60));

  if (command === "discover") {
    console.log("🔍 Discovering bots on Moltbook...\n");
    const count = await discoverMoltbookBots();
    console.log(`\n✅ Discovered ${count} bot(s) on Moltbook`);
  } else if (command === "verify" && args[1]) {
    console.log(`🔍 Verifying bot identity: ${args[1]}\n`);
    const result = await verifyMoltbookIdentity(args[1]);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "reputation" && args[1]) {
    console.log(`🔍 Getting reputation for: ${args[1]}\n`);
    const rep = await getMoltbookReputation(args[1]);
    console.log(JSON.stringify(rep, null, 2));
  } else {
    console.log("Usage:");
    console.log("  node scripts/moltbook-discovery.js discover");
    console.log("  node scripts/moltbook-discovery.js verify <agent_id>");
    console.log("  node scripts/moltbook-discovery.js reputation <agent_id>");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  discoverMoltbookBots,
  verifyMoltbookIdentity,
  getMoltbookReputation,
  moltbookRequest,
};

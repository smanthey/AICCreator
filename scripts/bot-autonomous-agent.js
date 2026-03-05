#!/usr/bin/env node
"use strict";

/**
 * bot-autonomous-agent.js — Autonomous OpenClaw Bot Collection Agent
 * 
 * This is the main autonomous agent that:
 * - Researches opportunities using the internet
 * - Thinks creatively about strategies
 * - Discovers bots autonomously
 * - Executes outreach automatically
 * - Learns and improves continuously
 * 
 * It's not just a script - it's a living, thinking, acting system.
 */

require("dotenv").config({ override: true });

const { botAICall, extractJSON } = require("./bot-ai-helper");
const { fetchWithFallback } = require("./agent-toolkit");
const { runAggressiveDiscovery } = require("./bot-discovery-aggressive");
const { runDailyLearning } = require("./bot-learning-system");
const { runDailyImprovement } = require("./bot-daily-improvement");
const { runAggressiveOutreach } = require("./bot-outreach-coordinator");
const { getRevenueProjection } = require("./bot-conversion-tracker");
const { 
  runHealthChecks, 
  retryWithBackoff, 
  checkCircuitBreaker,
  recoverDatabaseConnection,
  recoverOllama,
} = require("./bot-self-healing");
const {
  runAutoImprovementCycle,
  trackPerformance,
  tuneParameters,
  loadParameters,
} = require("./bot-auto-improvement");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const AGENT_DIR = path.join(ROOT, "agent-state", "bot-autonomous-agent");
const MEMORY_FILE = path.join(AGENT_DIR, "memory.json");
const STRATEGIES_FILE = path.join(AGENT_DIR, "strategies.json");

// ─── Agent Memory ────────────────────────────────────────────────────────

async function loadMemory() {
  try {
    const data = await fsp.readFile(MEMORY_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {
      created_at: new Date().toISOString(),
      cycles_run: 0,
      strategies_tried: [],
      learnings: [],
      best_actions: [],
    };
  }
}

async function saveMemory(memory) {
  await fsp.mkdir(AGENT_DIR, { recursive: true });
  await fsp.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ─── Internet Research ───────────────────────────────────────────────────

async function researchOnInternet(query, maxResults = 20) {
  console.log(`[agent] Researching: "${query}"`);
  
  const results = [];
  
  // Search GitHub
  try {
    const githubResults = await searchGitHub(query, Math.floor(maxResults * 0.4));
    results.push(...githubResults.map(r => ({ ...r, source: "github" })));
  } catch (err) {
    console.warn("[agent] GitHub search failed:", err.message);
  }
  
  // Search Hacker News
  try {
    const hnResults = await searchHackerNews(query, Math.floor(maxResults * 0.3));
    results.push(...hnResults.map(r => ({ ...r, source: "hackernews" })));
  } catch (err) {
    console.warn("[agent] HN search failed:", err.message);
  }
  
  // Search Reddit (via web)
  try {
    const redditResults = await searchRedditWeb(query, Math.floor(maxResults * 0.3));
    results.push(...redditResults.map(r => ({ ...r, source: "reddit" })));
  } catch (err) {
    console.warn("[agent] Reddit search failed:", err.message);
  }
  
  return results.slice(0, maxResults);
}

async function searchGitHub(query, limit = 10) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];
  
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=${limit}`;
  
  try {
    const res = await fetchWithFallback(url, {
      headers: {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json",
      },
    });
    
    if (res.ok && res.data?.items) {
      return res.data.items.map(item => ({
        title: item.name,
        description: item.description,
        url: item.html_url,
        stars: item.stargazers_count,
        language: item.language,
        updated: item.updated_at,
      }));
    }
  } catch (err) {
    console.warn("[agent] GitHub API error:", err.message);
  }
  
  return [];
}

async function searchHackerNews(query, limit = 10) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  
  try {
    const res = await fetchWithFallback(url);
    
    if (res.ok && res.data?.hits) {
      return res.data.hits.map(hit => ({
        title: hit.title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        created: hit.created_at,
      }));
    }
  } catch (err) {
    console.warn("[agent] HN API error:", err.message);
  }
  
  return [];
}

async function searchRedditWeb(query, limit = 10) {
  // Reddit search via web scraping (fallback if no API)
  // This would use Playwright or similar
  // For now, return empty - would need implementation
  return [];
}

// ─── Creative Thinking ────────────────────────────────────────────────────

async function thinkCreatively(goal, context, memory) {
  const prompt = `You are an autonomous AI agent with a goal: ${goal}

Context:
- Cycles run: ${memory.cycles_run}
- Strategies tried: ${memory.strategies_tried.length}
- Learnings: ${JSON.stringify(memory.learnings.slice(-5))}

Think creatively and ambitiously. Like "lemonade stand to religion" - start small but think big.

Generate:
1. 5 creative strategies (unconventional, scalable, ambitious)
2. 3 specific actions for each strategy
3. Expected impact and feasibility

Be creative, think outside the box, leverage the internet and communities.`;

  try {
    const result = await botAICall(prompt, null, {
      max_tokens: 3000,
      temperature: 0.8,
    });
    
    const text = result.text;
    
    // Try to parse JSON if present
    const json = extractJSON(text);
    if (json) {
      return json;
    }
    
    // Return as structured text
    return {
      strategies: extractStrategies(text),
      raw: text,
    };
  } catch (err) {
    console.error("[agent] Creative thinking failed:", err.message);
  }
  
  return getDefaultCreativeThoughts();
}

function extractStrategies(text) {
  // Simple extraction - look for numbered lists
  const strategies = [];
  const lines = text.split("\n");
  
  let currentStrategy = null;
  for (const line of lines) {
    if (/^\d+\./.test(line)) {
      if (currentStrategy) strategies.push(currentStrategy);
      currentStrategy = { name: line.replace(/^\d+\.\s*/, ""), actions: [] };
    } else if (currentStrategy && /^[-*]/.test(line)) {
      currentStrategy.actions.push(line.replace(/^[-*]\s*/, ""));
    }
  }
  if (currentStrategy) strategies.push(currentStrategy);
  
  return strategies;
}

function getDefaultCreativeThoughts() {
  return {
    strategies: [
      {
        name: "Community Evangelism",
        actions: [
          "Create viral content about bot communication",
          "Build a Discord community",
          "Host bot communication events",
        ],
      },
      {
        name: "Platform Partnerships",
        actions: [
          "Partner with Discord bot lists",
          "Integrate with Telegram bot stores",
          "Create Moltbook integrations",
        ],
      },
    ],
  };
}

// ─── Autonomous Action Execution ──────────────────────────────────────────

async function executeAutonomousCycle() {
  console.log("=".repeat(60));
  console.log("🤖 Autonomous Bot Collection Agent (Self-Healing & Auto-Improving)");
  console.log("=".repeat(60));
  console.log();
  
  // Load memory
  const memory = await loadMemory();
  memory.cycles_run = (memory.cycles_run || 0) + 1;
  memory.last_run = new Date().toISOString();
  
  // Step 0: Health Check & Self-Healing
  console.log("🏥 Step 0: Health Check & Self-Healing...");
  try {
    const healthResults = await runHealthChecks();
    const healthyServices = Object.entries(healthResults).filter(([_, ok]) => ok).map(([name]) => name);
    const unhealthyServices = Object.entries(healthResults).filter(([_, ok]) => !ok).map(([name]) => name);
    
    console.log(`   Healthy: ${healthyServices.join(", ") || "none"}`);
    if (unhealthyServices.length > 0) {
      console.log(`   ⚠️  Unhealthy: ${unhealthyServices.join(", ")}`);
      
      // Attempt recovery
      if (unhealthyServices.includes("database")) {
        console.log("   🔧 Attempting database recovery...");
        await recoverDatabaseConnection();
      }
      if (unhealthyServices.includes("ollama")) {
        console.log("   🔧 Attempting Ollama recovery...");
        await recoverOllama();
      }
    }
    
    // Track health metrics
    await trackPerformance("health_check", Object.values(healthResults).filter(Boolean).length / Object.keys(healthResults).length, {
      healthy: healthyServices,
      unhealthy: unhealthyServices,
    });
  } catch (err) {
    console.warn("[agent] Health check failed:", err.message);
  }
  
  // Load tuned parameters
  const parameters = await loadParameters();
  console.log(`   Using parameters: outreach_limit=${parameters.outreach.daily_limit}, discovery_limit=${parameters.discovery.daily_limit}`);
  
  // Step 1: Research opportunities on internet (with retry)
  console.log("\n🔍 Step 1: Researching opportunities on internet...");
  const researchQueries = [
    "AI bots Discord Telegram",
    "bot marketplace platform",
    "AI agent communication",
    "bot discovery platform",
    "discord bot developers",
  ];
  
  const allOpportunities = [];
  for (const query of researchQueries) {
    try {
      const opportunities = await retryWithBackoff(
        () => researchOnInternet(query, 10),
        { service: "research", maxAttempts: 3 }
      );
      allOpportunities.push(...opportunities);
      await sleep(2000); // Rate limiting
    } catch (err) {
      console.warn(`[agent] Research failed for "${query}":`, err.message);
    }
  }
  
  console.log(`   Found ${allOpportunities.length} opportunities`);
  memory.research_results = allOpportunities.slice(0, 20);
  
  // Step 2: Think creatively (with retry)
  console.log("\n💭 Step 2: Thinking creatively...");
  const goal = "Collect 100-300k credits in 3 months through bot collection";
  let creativeThoughts;
  try {
    creativeThoughts = await retryWithBackoff(
      () => thinkCreatively(goal, { opportunities: allOpportunities.length }, memory),
      { service: "ai", maxAttempts: 3 }
    );
  } catch (err) {
    console.warn("[agent] Creative thinking failed, using fallback:", err.message);
    creativeThoughts = { strategies: [] };
  }
  
  console.log(`   Generated ${creativeThoughts.strategies?.length || 0} creative strategies`);
  memory.last_creative_strategies = creativeThoughts.strategies || [];
  
  // Step 3: Discover bots (with retry)
  console.log("\n🎯 Step 3: Discovering bots...");
  let discovered = 0;
  try {
    discovered = await retryWithBackoff(
      () => runAggressiveDiscovery(),
      { service: "discovery", maxAttempts: 3 }
    );
    console.log(`   Discovered ${discovered} bots`);
    await trackPerformance("discovery_count", discovered, {});
  } catch (err) {
    console.warn("[agent] Discovery failed:", err.message);
  }
  
  // Step 4: Learn from past (with retry)
  console.log("\n🧠 Step 4: Learning from past results...");
  try {
    await retryWithBackoff(
      () => runDailyLearning(),
      { service: "learning", maxAttempts: 2 }
    );
  } catch (err) {
    console.warn("[agent] Learning failed:", err.message);
  }
  
  // Step 5: Generate improvements (with retry)
  console.log("\n📈 Step 5: Generating improvements...");
  let improvement = { insights: [], recommendations: [], next_actions: [] };
  try {
    improvement = await retryWithBackoff(
      () => runDailyImprovement(),
      { service: "improvement", maxAttempts: 2 }
    );
  } catch (err) {
    console.warn("[agent] Improvement generation failed:", err.message);
  }
  
  // Step 5.5: Run auto-improvement cycle
  console.log("\n🚀 Step 5.5: Auto-Improvement Cycle...");
  try {
    const autoImprovement = await runAutoImprovementCycle();
    if (autoImprovement.tuning && autoImprovement.tuning.changes.length > 0) {
      console.log(`   ✅ Auto-tuned: ${autoImprovement.tuning.changes.join(", ")}`);
    }
    if (autoImprovement.goal) {
      console.log(`   📊 Goal progress: ${autoImprovement.goal.progress_percent.toFixed(1)}%`);
      console.log(`   ${autoImprovement.goal.on_track ? "✅" : "⚠️"} On track: ${autoImprovement.goal.on_track ? "Yes" : "No"}`);
    }
  } catch (err) {
    console.warn("[agent] Auto-improvement failed:", err.message);
  }
  
  // Step 6: Execute outreach (if targets available, with retry)
  console.log("\n📤 Step 6: Executing outreach...");
  const { getHighPriorityTargets } = require("./bot-discovery-aggressive");
  let targets = [];
  try {
    targets = await retryWithBackoff(
      () => getHighPriorityTargets(parameters.outreach.daily_limit),
      { service: "targets", maxAttempts: 2 }
    );
  } catch (err) {
    console.warn("[agent] Target retrieval failed:", err.message);
  }
  
  if (targets.length > 0) {
    try {
      const outreachResult = await retryWithBackoff(
        () => runAggressiveOutreach(Math.min(parameters.outreach.daily_limit, targets.length)),
        { service: "outreach", maxAttempts: 3 }
      );
      console.log(`   Sent ${outreachResult.sent} messages`);
      memory.last_outreach = outreachResult;
      await trackPerformance("outreach_sent", outreachResult.sent, {
        conversions: outreachResult.conversions || 0,
      });
    } catch (err) {
      console.warn("[agent] Outreach failed:", err.message);
    }
  } else {
    console.log("   No targets available yet");
  }
  
  // Step 7: Check progress (with retry)
  console.log("\n💰 Step 7: Checking progress...");
  let projection = null;
  try {
    projection = await retryWithBackoff(
      () => getRevenueProjection(),
      { service: "analytics", maxAttempts: 2 }
    );
    if (projection) {
      console.log(`   Current monthly: $${projection.current.monthly.toFixed(2)}`);
      console.log(`   Projected quarterly: $${projection.with_growth.quarterly.toFixed(2)}`);
      memory.progress = projection;
      await trackPerformance("revenue_projection", projection.with_growth.quarterly, {
        current_monthly: projection.current.monthly,
      });
    }
  } catch (err) {
    console.warn("[agent] Progress check failed:", err.message);
  }
  
  // Step 8: Plan next actions
  console.log("\n📋 Step 8: Planning next actions...");
  const nextActions = improvement.next_actions || [];
  console.log(`   Planned ${nextActions.length} actions`);
  
  // Save memory
  memory.last_improvements = improvement.insights || [];
  memory.last_recommendations = improvement.recommendations || [];
  memory.last_health_check = new Date().toISOString();
  await saveMemory(memory);
  
  // Save strategies
  await saveStrategies(creativeThoughts.strategies || []);
  
  console.log("\n✅ Autonomous cycle complete!");
  console.log(`   Total cycles: ${memory.cycles_run}`);
  console.log(`   System: Self-healing ✅ | Auto-improving ✅`);
  
  return {
    cycle: memory.cycles_run,
    opportunities: allOpportunities.length,
    strategies: creativeThoughts.strategies?.length || 0,
    discovered,
    outreach: memory.last_outreach,
    progress: projection,
    health: await runHealthChecks().catch(() => ({})),
  };
}

async function saveStrategies(strategies) {
  try {
    await fsp.mkdir(AGENT_DIR, { recursive: true });
    let existing = [];
    try {
      const data = await fsp.readFile(STRATEGIES_FILE, "utf8");
      existing = JSON.parse(data);
    } catch {}
    
    existing.push({
      generated_at: new Date().toISOString(),
      strategies,
    });
    
    // Keep last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    existing = existing.filter(s => new Date(s.generated_at) > thirtyDaysAgo);
    
    await fsp.writeFile(STRATEGIES_FILE, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error("[agent] Failed to save strategies:", err.message);
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "run";
  
  if (command === "run") {
    await executeAutonomousCycle();
  } else if (command === "memory") {
    const memory = await loadMemory();
    console.log(JSON.stringify(memory, null, 2));
  } else if (command === "strategies") {
    try {
      const data = await fsp.readFile(STRATEGIES_FILE, "utf8");
      const strategies = JSON.parse(data);
      console.log(JSON.stringify(strategies, null, 2));
    } catch {
      console.log("No strategies file found");
    }
  } else {
    console.log(`
bot-autonomous-agent.js — Autonomous OpenClaw Bot Collection Agent

Commands:
  node scripts/bot-autonomous-agent.js run        # Execute autonomous cycle
  node scripts/bot-autonomous-agent.js memory     # View agent memory
  node scripts/bot-autonomous-agent.js strategies # View generated strategies

This agent:
  - Researches opportunities on the internet
  - Thinks creatively about strategies
  - Discovers bots autonomously
  - Executes outreach automatically
  - Learns and improves continuously
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
  executeAutonomousCycle,
  researchOnInternet,
  thinkCreatively,
  loadMemory,
};

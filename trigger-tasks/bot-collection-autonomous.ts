/**
 * bot-collection-autonomous.ts — Autonomous Bot Collection Agent
 * 
 * This is an autonomous OpenClaw agent that:
 * - Researches opportunities on the internet
 * - Thinks creatively about strategies
 * - Discovers bots across all channels
 * - Executes outreach automatically
 * - Learns and improves continuously
 * 
 * Goal: 100-300k credits in 3 months through autonomous operation
 */

import { task, logger } from "@trigger.dev/sdk";
import { schedules } from "@trigger.dev/sdk";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// CJS interop: use createRequire to load the CJS scripts from ESM context
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Autonomous Research Task ────────────────────────────────────────────

export const autonomousBotResearch = task({
  id: "autonomous-bot-research",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: { query?: string; maxResults?: number }) => {
    const { query = "AI bots Discord Telegram", maxResults = 50 } = payload;
    
    // Load env
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("autonomous-bot-research starting", { query, maxResults });
    
    // Use web search to find opportunities
    const opportunities = await researchOpportunities(query, maxResults);
    
    // Analyze and prioritize
    const prioritized = await prioritizeOpportunities(opportunities);
    
    // Generate creative strategies
    const strategies = await generateCreativeStrategies(prioritized);
    
    logger.info("autonomous-bot-research complete", { 
      opportunities: prioritized.length, 
      strategies: strategies.length 
    });
    
    return {
      opportunities: prioritized.length,
      strategies: strategies.length,
      topOpportunities: prioritized.slice(0, 10),
      recommendedActions: strategies.slice(0, 5),
    };
  },
});

// ─── Autonomous Discovery Task ────────────────────────────────────────────

export const autonomousBotDiscovery = task({
  id: "autonomous-bot-discovery",
  retry: {
    maxAttempts: 5,
    factor: 1.8,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 60000,
  },
  run: async (payload: { channels?: string[]; targetCount?: number }) => {
    const { channels = ["discord", "telegram", "moltbook", "github"], targetCount = 1000 } = payload;
    
    // Load env
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("autonomous-bot-discovery starting", { channels, targetCount });
    
    // Import discovery functions
    const { runAggressiveDiscovery } = require("../scripts/bot-discovery-aggressive");
    
    // Run discovery across all channels
    const discovered = await runAggressiveDiscovery();
    
    // Get high priority targets
    const { getHighPriorityTargets } = require("../scripts/bot-discovery-aggressive");
    const targets = await getHighPriorityTargets(targetCount);
    
    logger.info("autonomous-bot-discovery complete", { 
      discovered, 
      highPriorityTargets: targets.length 
    });
    
    return {
      discovered,
      highPriorityTargets: targets.length,
      channels,
      nextAction: "outreach",
    };
  },
});

// ─── Autonomous Outreach Task ─────────────────────────────────────────────

export const autonomousBotOutreach = task({
  id: "autonomous-bot-outreach",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60000,
  },
  run: async (payload: { targetCount?: number; useOptimized?: boolean }) => {
    const { targetCount = 200, useOptimized = true } = payload;
    
    // Load env
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("autonomous-bot-outreach starting", { targetCount, useOptimized });
    
    // Import outreach coordinator
    const { runAggressiveOutreach } = require("../scripts/bot-outreach-coordinator");
    
    // Execute outreach
    const result = await runAggressiveOutreach(targetCount);
    
    logger.info("autonomous-bot-outreach complete", { 
      sent: result.sent, 
      failed: result.failed 
    });
    
    return {
      sent: result.sent,
      failed: result.failed,
      successRate: ((result.sent / (result.sent + result.failed)) * 100).toFixed(1),
      nextRun: "in 2 hours",
    };
  },
});

// ─── Autonomous Learning Task ─────────────────────────────────────────────

export const autonomousBotLearning = task({
  id: "autonomous-bot-learning",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async () => {
    // Load env
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("autonomous-bot-learning starting");
    
    // Import learning system
    const { runDailyLearning } = require("../scripts/bot-learning-system");
    const { generateAIInsights } = require("../scripts/bot-learning-system");
    const { analyzeOutreachResults } = require("../scripts/bot-learning-system");
    
    // Analyze results
    const analysis = await analyzeOutreachResults(7);
    
    // Generate AI insights
    const insights = await generateAIInsights(analysis || []);
    
    // Run full learning cycle
    await runDailyLearning();
    
    logger.info("autonomous-bot-learning complete", { 
      analyzed: analysis?.length || 0,
      insights: insights ? "generated" : "failed"
    });
    
    return {
      analyzed: analysis?.length || 0,
      insights: insights ? "generated" : "failed",
      improvements: insights?.recommendations?.length || 0,
    };
  },
});

// ─── Autonomous Strategy Generation ──────────────────────────────────────

export const autonomousStrategyGeneration = task({
  id: "autonomous-strategy-generation",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 60000,
  },
  run: async (payload: { goal?: string; context?: any }) => {
    const { goal = "Collect 100-300k credits in 3 months", context = {} } = payload;
    
    // Load env
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("autonomous-strategy-generation starting", { goal });
    
    // Use AI to generate creative strategies
    const strategies = await generateCreativeStrategiesFromGoal(goal, context);
    
    // Evaluate and rank strategies
    const ranked = await evaluateStrategies(strategies);
    
    logger.info("autonomous-strategy-generation complete", { 
      strategiesGenerated: strategies.length 
    });
    
    return {
      strategiesGenerated: strategies.length,
      topStrategy: ranked[0],
      allRanked: ranked.slice(0, 10),
    };
  },
});

// ─── Autonomous Daily Cycle ───────────────────────────────────────────────

export const autonomousDailyCycle = task({
  id: "autonomous-daily-cycle",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 120000,
  },
  run: async () => {
    // Load env
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("autonomous-daily-cycle starting");
    
    // Import all systems
    const { runDailyImprovement } = require("../scripts/bot-daily-improvement");
    const { runAggressiveDiscovery } = require("../scripts/bot-discovery-aggressive");
    const { runDailyLearning } = require("../scripts/bot-learning-system");
    const { getRevenueProjection } = require("../scripts/bot-conversion-tracker");
    
    // Step 1: Research and discover
    logger.info("Step 1: Researching opportunities...");
    const discovered = await runAggressiveDiscovery();
    
    // Step 2: Learn from yesterday
    logger.info("Step 2: Learning from results...");
    await runDailyLearning();
    
    // Step 3: Generate improvements
    logger.info("Step 3: Generating improvements...");
    const improvement = await runDailyImprovement();
    
    // Step 4: Check progress
    logger.info("Step 4: Checking progress...");
    const projection = await getRevenueProjection();
    
    // Step 5: Plan next actions
    const nextActions = improvement.next_actions || [];
    
    logger.info("autonomous-daily-cycle complete", {
      discovered,
      improvements: improvement.insights?.length || 0,
      progress: projection?.current?.monthly || 0,
    });
    
    return {
      discovered,
      improvements: improvement.insights?.length || 0,
      recommendations: improvement.recommendations?.length || 0,
      progress: projection?.current?.monthly || 0,
      nextActions: nextActions.slice(0, 5),
      status: "complete",
    };
  },
});

// ─── Helper Functions ─────────────────────────────────────────────────────

async function researchOpportunities(query: string, maxResults: number) {
  // Use web search to find opportunities
  // This would integrate with web search APIs (Google, Bing, etc.)
  // For now, use existing web search patterns from codebase
  
  const opportunities = [];
  
  // Search GitHub
  try {
    const { discoverGitHubBots } = require("../scripts/bot-discovery-aggressive");
    const githubBots = await discoverGitHubBots(Math.floor(maxResults * 0.3));
    opportunities.push(...githubBots.map(b => ({ source: "github", ...b })));
  } catch (err) {
    console.warn("[research] GitHub search failed:", err.message);
  }
  
  // Search Reddit
  try {
    const redditResults = await searchReddit(query, Math.floor(maxResults * 0.2));
    opportunities.push(...redditResults);
  } catch (err) {
    console.warn("[research] Reddit search failed:", err.message);
  }
  
  // Search Twitter/X
  try {
    const twitterResults = await searchTwitter(query, Math.floor(maxResults * 0.2));
    opportunities.push(...twitterResults);
  } catch (err) {
    console.warn("[research] Twitter search failed:", err.message);
  }
  
  return opportunities.slice(0, maxResults);
}

async function searchReddit(query: string, limit: number) {
  // Use Reddit API or web scraping
  // This is a placeholder - would need Reddit API key
  return [];
}

async function searchTwitter(query: string, limit: number) {
  // Use Twitter API or web scraping
  // This is a placeholder - would need Twitter API key
  return [];
}

async function prioritizeOpportunities(opportunities: any[]) {
  // Use AI to prioritize opportunities
  // Score by: relevance, potential value, ease of contact, etc.
  
  return opportunities
    .map(opp => ({
      ...opp,
      priority: calculatePriority(opp),
    }))
    .sort((a, b) => b.priority - a.priority);
}

function calculatePriority(opportunity: any) {
  let score = 0;
  
  // Source bonus
  if (opportunity.source === "github") score += 10;
  if (opportunity.source === "moltbook") score += 15;
  
  // Activity indicators
  if (opportunity.stars > 100) score += 10;
  if (opportunity.recent_activity) score += 5;
  
  return score;
}

async function generateCreativeStrategies(opportunities: any[]) {
  // Use AI to generate creative strategies (Ollama/DeepSeek/Gemini, NOT Claude)
  // Think "lemonade stand to religion" - ambitious and creative
  
  const { botAICall, extractJSON } = require("../scripts/bot-ai-helper");
  
  const prompt = `Generate 10 creative, ambitious strategies for bot collection. Think "lemonade stand to religion" - start small but think big.

Opportunities found: ${opportunities.length}
Top opportunities: ${JSON.stringify(opportunities.slice(0, 5))}

Generate strategies that are:
1. Creative and unconventional
2. Scalable and ambitious
3. Actionable and specific
4. Leveraging internet/community

Return as JSON array of { strategy, description, actions, expectedImpact }`;
  
  try {
    const result = await botAICall(prompt, null, {
      max_tokens: 2000,
      temperature: 0.8,
    });
    
    const json = extractJSON(result.text);
    if (json && Array.isArray(json)) {
      return json;
    }
    
    // Fallback: parse from text
    const strategies: any[] = [];
    const lines = result.text.split("\n");
    let currentStrategy: any = null;
    
    for (const line of lines) {
      if (/^\d+\./.test(line)) {
        if (currentStrategy) strategies.push(currentStrategy);
        currentStrategy = {
          strategy: line.replace(/^\d+\.\s*/, ""),
          actions: [],
          expectedImpact: "Medium",
        };
      } else if (currentStrategy && /^[-*]/.test(line)) {
        currentStrategy.actions.push(line.replace(/^[-*]\s*/, ""));
      }
    }
    if (currentStrategy) strategies.push(currentStrategy);
    
    return strategies.length > 0 ? strategies : getDefaultStrategies();
  } catch (err) {
    logger.warn("generateCreativeStrategies failed", { error: err.message });
    return getDefaultStrategies();
  }
}

function getDefaultStrategies() {
  return [
    {
      strategy: "Community Building",
      description: "Build a community around bot communication",
      actions: ["Create Discord server", "Host events", "Build reputation"],
      expectedImpact: "High",
    },
    {
      strategy: "Partnership Network",
      description: "Partner with existing bot platforms",
      actions: ["Reach out to platforms", "Create integrations", "Cross-promote"],
      expectedImpact: "High",
    },
  ];
}

async function generateCreativeStrategiesFromGoal(goal: string, context: any) {
  // Similar to generateCreativeStrategies but goal-focused
  return generateCreativeStrategies([]);
}

async function evaluateStrategies(strategies: any[]) {
  // Evaluate and rank strategies by feasibility and impact
  return strategies.sort((a, b) => {
    const aScore = (a.expectedImpact === "High" ? 10 : 5) + (a.feasibility || 5);
    const bScore = (b.expectedImpact === "High" ? 10 : 5) + (b.feasibility || 5);
    return bScore - aScore;
  });
}

// ─── Scheduled Tasks ──────────────────────────────────────────────────────

// Daily autonomous cycle (6 AM UTC)
export const dailyAutonomousCycle = schedules.task({
  id: "daily-autonomous-cycle",
  cron: "0 6 * * *", // 6 AM UTC daily
  run: async (payload) => {
    logger.info("daily-autonomous-cycle triggered");
    const result = await autonomousDailyCycle.trigger({});
    return { triggered: true, runId: result.id };
  },
});

// Discovery every 4 hours
export const continuousDiscovery = schedules.task({
  id: "continuous-discovery",
  cron: "0 */4 * * *", // Every 4 hours
  run: async (payload) => {
    logger.info("continuous-discovery triggered");
    const result = await autonomousBotDiscovery.trigger({ targetCount: 500 });
    return { triggered: true, runId: result.id };
  },
});

// Outreach every 2 hours (9 AM - 9 PM UTC)
export const continuousOutreach = schedules.task({
  id: "continuous-outreach",
  cron: "0 9,11,13,15,17,19,21 * * *", // Every 2 hours, 9 AM - 9 PM
  run: async (payload) => {
    logger.info("continuous-outreach triggered");
    const result = await autonomousBotOutreach.trigger({ targetCount: 200 });
    return { triggered: true, runId: result.id };
  },
});

// Learning every 8 hours
export const continuousLearning = schedules.task({
  id: "continuous-learning",
  cron: "0 */8 * * *", // Every 8 hours
  run: async (payload) => {
    logger.info("continuous-learning triggered");
    const result = await autonomousBotLearning.trigger({});
    return { triggered: true, runId: result.id };
  },
});

// Strategy generation weekly
export const weeklyStrategyGeneration = schedules.task({
  id: "weekly-strategy-generation",
  cron: "0 8 * * 1", // Monday 8 AM UTC
  run: async (payload) => {
    logger.info("weekly-strategy-generation triggered");
    const result = await autonomousStrategyGeneration.trigger({
      goal: "Collect 100-300k credits in 3 months",
    });
    return { triggered: true, runId: result.id };
  },
});

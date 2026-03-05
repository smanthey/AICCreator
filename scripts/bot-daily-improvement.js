#!/usr/bin/env node
"use strict";

/**
 * bot-daily-improvement.js — Daily Research and Improvement Cycle
 * 
 * Runs daily to:
 * 1. Analyze yesterday's performance
 * 2. Learn from results
 * 3. Generate improvements
 * 4. Update strategies
 * 5. Plan tomorrow's outreach
 * 
 * Goal: Continuously improve conversion rates to reach 100-300k credits in 3 months
 */

require("dotenv").config({ override: true });

const { runDailyLearning } = require("./bot-learning-system");
const { getConversionStats, getFunnelMetrics, getRevenueProjection } = require("./bot-conversion-tracker");
const { getHighPriorityTargets } = require("./bot-discovery-aggressive");
const { getBestMessages, saveInsight } = require("./bot-learning-system");
const { suggestNewVariantsToTest } = require("./bot-message-optimizer");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IMPROVEMENT_DIR = path.join(ROOT, "agent-state", "bot-improvement");
const DAILY_REPORTS = path.join(IMPROVEMENT_DIR, "daily-reports");
const GOAL_START_DATE = process.env.BOT_GOAL_START_DATE || "2026-01-01";

function getDaysElapsed(startDate) {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  const elapsedMs = Date.now() - start.getTime();
  return Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
}

// ─── Daily Improvement Cycle ───────────────────────────────────────────────

async function runDailyImprovement() {
  console.log("=".repeat(60));
  console.log("🚀 Daily Improvement Cycle");
  console.log("=".repeat(60));
  console.log(`Date: ${new Date().toISOString().split("T")[0]}`);
  console.log();
  
  const report = {
    date: new Date().toISOString().split("T")[0],
    timestamp: new Date().toISOString(),
    steps: {},
    insights: [],
    recommendations: [],
    next_actions: [],
  };
  
  // Step 1: Analyze Performance
  console.log("📊 Step 1: Analyzing Performance...");
  const stats = await getConversionStats(1); // Yesterday
  const funnel = await getFunnelMetrics(7); // Last week
  const projection = await getRevenueProjection();
  
  report.steps.performance = {
    stats,
    funnel,
    projection,
  };
  
  if (stats) {
    console.log(`   Conversions yesterday: ${stats.conversions_today || 0}`);
    console.log(`   Revenue yesterday: $${parseFloat(stats.total_revenue || 0).toFixed(2)}`);
  }
  
  if (funnel) {
    console.log(`   Overall conversion rate: ${funnel.overall_conversion}%`);
  }
  
  // Step 2: Learning from Results
  console.log("\n🧠 Step 2: Learning from Results...");
  await runDailyLearning();
  
  // Step 3: Identify Best Performers
  console.log("\n⭐ Step 3: Identifying Best Performers...");
  const bestMessages = await getBestMessages(null, 10);
  
  report.steps.best_performers = bestMessages;
  
  if (bestMessages.length > 0) {
    console.log(`   Found ${bestMessages.length} top-performing message variants`);
    bestMessages.slice(0, 3).forEach((m, i) => {
      console.log(`     ${i + 1}. ${m.message_variant} (${m.platform}) - ${(parseFloat(m.conversion_rate) * 100).toFixed(1)}%`);
    });
  }
  
  // Step 4: Generate Improvements
  console.log("\n💡 Step 4: Generating Improvements...");
  const improvements = await generateImprovements(stats, funnel, bestMessages);
  
  report.insights = improvements.insights || [];
  report.recommendations = improvements.recommendations || [];
  
  if (improvements.recommendations) {
    console.log(`   Generated ${improvements.recommendations.length} recommendations`);
    improvements.recommendations.slice(0, 3).forEach((r, i) => {
      console.log(`     ${i + 1}. ${r}`);
    });
  }
  
  // Step 5: Plan Tomorrow's Strategy
  console.log("\n📅 Step 5: Planning Tomorrow's Strategy...");
  const strategy = await planTomorrowStrategy(stats, funnel, bestMessages);
  
  report.next_actions = strategy.actions || [];
  report.steps.strategy = strategy;
  
  console.log(`   Planned ${strategy.actions?.length || 0} actions for tomorrow`);
  
  // Step 6: Get High Priority Targets
  console.log("\n🎯 Step 6: Identifying High Priority Targets...");
  const targets = await getHighPriorityTargets(100);
  
  report.steps.targets = {
    count: targets.length,
    top_5: targets.slice(0, 5).map(t => ({
      bot_id: t.bot_id,
      platform: t.platform,
      priority: t.priority_score,
    })),
  };
  
  console.log(`   Found ${targets.length} high-priority targets`);
  
  // Step 7: Calculate Progress to Goal
  console.log("\n🎯 Step 7: Progress to Goal...");
  const goal = {
    target_credits: 100000, // 100k minimum
    target_days: 90, // 3 months
    current_credits: parseFloat(stats?.total_revenue || 0),
    days_elapsed: getDaysElapsed(GOAL_START_DATE),
  };
  
  goal.progress_percent = Number(goal.target_credits > 0 ? (goal.current_credits / goal.target_credits * 100) : 0).toFixed(2);
  const daysRemaining = (goal.target_days - goal.days_elapsed) || 1; // avoid divide-by-zero
  goal.daily_needed = Number((goal.target_credits - goal.current_credits) / daysRemaining).toFixed(2);
  
  report.steps.goal = goal;
  
  console.log(`   Current: $${Number(goal.current_credits || 0).toFixed(2)}`);
  console.log(`   Target: $${Number(goal.target_credits || 0).toFixed(2)}`);
  console.log(`   Progress: ${goal.progress_percent}%`);
  console.log(`   Daily needed: $${goal.daily_needed}`);
  
  // Save Report
  await saveDailyReport(report);
  
  console.log("\n✅ Daily improvement cycle complete!");
  console.log(`\n📄 Report saved to: ${path.join(DAILY_REPORTS, `${report.date}.json`)}`);
  
  return report;
}

// ─── Generate Improvements ────────────────────────────────────────────────

async function generateImprovements(stats, funnel, bestMessages) {
  const insights = [];
  const recommendations = [];
  
  // Analyze conversion rate
  if (funnel && parseFloat(funnel.overall_conversion) < 5) {
    insights.push("Conversion rate below 5% target - need to improve messaging");
    recommendations.push("Test new message variants with stronger value propositions");
    recommendations.push("Focus on high-priority targets first");
  }
  
  // Analyze platform performance
  if (stats) {
    const platforms = {
      discord: stats.discord_conversions || 0,
      telegram: stats.telegram_conversions || 0,
      moltbook: stats.moltbook_conversions || 0,
    };
    
    const bestPlatform = Object.entries(platforms).sort((a, b) => b[1] - a[1])[0];
    if (bestPlatform) {
      insights.push(`${bestPlatform[0]} is performing best with ${bestPlatform[1]} conversions`);
      recommendations.push(`Increase outreach on ${bestPlatform[0]} platform`);
    }
  }
  
  // Analyze message performance
  if (bestMessages && bestMessages.length > 0) {
    const topMessage = bestMessages[0];
    insights.push(`Best message: ${topMessage.message_variant} with ${(parseFloat(topMessage.conversion_rate) * 100).toFixed(1)}% conversion`);
    recommendations.push(`Use "${topMessage.message_variant}" variant more frequently`);
    
    // Suggest new variants
    try {
      const newVariants = await suggestNewVariantsToTest(topMessage.message_variant, 3);
      if (newVariants && newVariants.length > 0) {
        recommendations.push(`Test new variants: ${newVariants.slice(0, 2).join(", ")}`);
      }
    } catch (err) {
      console.warn("[improvement] Could not generate new variants:", err.message);
    }
  }
  
  // Volume recommendations
  if (stats && parseFloat(stats.conversions_today || 0) < 10) {
    recommendations.push("Increase daily outreach volume to reach 10+ conversions/day");
  }
  
  return { insights, recommendations };
}

// ─── Plan Tomorrow's Strategy ─────────────────────────────────────────────

async function planTomorrowStrategy(stats, funnel, bestMessages) {
  const actions = [];
  
  // Calculate target outreach volume
  const currentDaily = parseFloat(stats?.conversions_today || 0);
  const targetDaily = 50; // Need ~50 conversions/day for 100k in 3 months
  const neededIncrease = Math.max(0, targetDaily - currentDaily);
  
  if (neededIncrease > 0) {
    const conversionRate = parseFloat(funnel?.overall_conversion || 0.05);
    const neededOutreach = Math.ceil(neededIncrease / (conversionRate / 100));
    actions.push(`Reach out to ${neededOutreach} new bots tomorrow`);
  }
  
  // Platform focus
  if (stats) {
    const platforms = {
      discord: stats.discord_conversions || 0,
      telegram: stats.telegram_conversions || 0,
      moltbook: stats.moltbook_conversions || 0,
    };
    
    const bestPlatform = Object.entries(platforms).sort((a, b) => b[1] - a[1])[0];
    if (bestPlatform) {
      actions.push(`Focus 60% of outreach on ${bestPlatform[0]} platform`);
    }
  }
  
  // Message strategy
  if (bestMessages && bestMessages.length > 0) {
    const topMessage = bestMessages[0];
    actions.push(`Use "${topMessage.message_variant}" variant for 50% of messages`);
  }
  
  // Testing
  actions.push("Test 3 new message variants (10% of outreach)");
  
  return { actions };
}

// ─── Save Daily Report ────────────────────────────────────────────────────

async function saveDailyReport(report) {
  try {
    await fsp.mkdir(DAILY_REPORTS, { recursive: true });
    const reportFile = path.join(DAILY_REPORTS, `${report.date}.json`);
    await fsp.writeFile(reportFile, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error("[improvement] Failed to save report:", err.message);
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "run";
  
  if (command === "run") {
    await runDailyImprovement();
  } else if (command === "report") {
    const date = args[1] || new Date().toISOString().split("T")[0];
    try {
      const reportFile = path.join(DAILY_REPORTS, `${date}.json`);
      const report = JSON.parse(await fsp.readFile(reportFile, "utf8"));
      console.log(JSON.stringify(report, null, 2));
    } catch (err) {
      console.error(`Report not found for ${date}`);
      process.exit(1);
    }
  } else {
    console.log(`
bot-daily-improvement.js — Daily Research and Improvement Cycle

Commands:
  node scripts/bot-daily-improvement.js run           # Run daily improvement cycle
  node scripts/bot-daily-improvement.js report [date]  # View report
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
  runDailyImprovement,
  generateImprovements,
  planTomorrowStrategy,
};

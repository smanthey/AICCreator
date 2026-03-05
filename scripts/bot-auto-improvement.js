#!/usr/bin/env node
"use strict";

/**
 * bot-auto-improvement.js — Auto-Improvement System for Bot Collection
 * 
 * Continuously improves the system:
 * - Performance tracking and analysis
 * - Automatic strategy optimization
 * - A/B testing automation
 * - Learning from failures
 * - Automatic parameter tuning
 * - Goal tracking and adjustment
 */

require("dotenv").config({ override: true });

const { Pool } = require("pg");
const fsp = require("fs/promises");
const path = require("path");
const { botAICall, extractJSON } = require("./bot-ai-helper");

const ROOT = path.join(__dirname, "..");
const IMPROVEMENT_DIR = path.join(ROOT, "agent-state", "bot-improvement");
const METRICS_FILE = path.join(IMPROVEMENT_DIR, "metrics.json");
const STRATEGIES_FILE = path.join(IMPROVEMENT_DIR, "strategies.json");
const PARAMETERS_FILE = path.join(IMPROVEMENT_DIR, "parameters.json");
const GOAL_START_DATE = process.env.BOT_GOAL_START_DATE || "2026-01-01";

function getDaysElapsed(startDate) {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  const elapsedMs = Date.now() - start.getTime();
  return Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
}

// Database connection
let pool = null;

async function initDatabase() {
  if (pool) return pool;
  
  try {
    pool = new Pool({
      host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
      port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
      user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
      password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
      database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
      connectionTimeoutMillis: 5000,
    });
    
    await pool.query("SELECT 1");
    return pool;
  } catch (err) {
    console.warn("[improvement] Database not available:", err.message);
    return null;
  }
}

// ─── Performance Tracking ───────────────────────────────────────────────────

async function trackPerformance(metric, value, metadata = {}) {
  await fsp.mkdir(IMPROVEMENT_DIR, { recursive: true });
  
  let metrics = {};
  try {
    const data = await fsp.readFile(METRICS_FILE, "utf8");
    metrics = JSON.parse(data);
  } catch {}
  
  if (!metrics[metric]) metrics[metric] = [];
  
  metrics[metric].push({
    value,
    timestamp: new Date().toISOString(),
    metadata,
  });
  
  // Keep only last 1000 entries per metric
  if (metrics[metric].length > 1000) {
    metrics[metric] = metrics[metric].slice(-1000);
  }
  
  await fsp.writeFile(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

async function getPerformanceTrend(metric, days = 7) {
  await fsp.mkdir(IMPROVEMENT_DIR, { recursive: true });
  
  let metrics = {};
  try {
    const data = await fsp.readFile(METRICS_FILE, "utf8");
    metrics = JSON.parse(data);
  } catch {}
  
  if (!metrics[metric]) return null;
  
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recent = metrics[metric].filter(m => new Date(m.timestamp) >= cutoff);
  
  if (recent.length === 0) return null;
  
  const values = recent.map(m => m.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const trend = values.length > 1 ? (values[values.length - 1] - values[0]) / values[0] : 0;
  
  return {
    metric,
    count: recent.length,
    average: avg,
    min,
    max,
    trend, // positive = improving, negative = degrading
    recent: values.slice(-10), // last 10 values
  };
}

// ─── Strategy Optimization ───────────────────────────────────────────────────

async function optimizeStrategy(strategyName, results) {
  const pool = await initDatabase();
  if (!pool) return null;
  
  // Analyze strategy performance
  const analysis = {
    total_runs: results.length,
    success_rate: results.filter(r => r.success).length / results.length,
    avg_conversion: results.reduce((sum, r) => sum + (r.conversion_rate || 0), 0) / results.length,
    avg_revenue: results.reduce((sum, r) => sum + (r.revenue || 0), 0) / results.length,
  };
  
  // Get AI suggestions for improvement
  const prompt = `Analyze this strategy performance and suggest improvements:

Strategy: ${strategyName}
Total Runs: ${analysis.total_runs}
Success Rate: ${(analysis.success_rate * 100).toFixed(1)}%
Avg Conversion: ${(analysis.avg_conversion * 100).toFixed(1)}%
Avg Revenue: $${Number(analysis.avg_revenue || 0).toFixed(2)}

Recent Results:
${JSON.stringify(results.slice(-10), null, 2)}

Suggest:
1. What's working well?
2. What should be changed?
3. Specific parameter adjustments
4. New tactics to try

Return as JSON: { strengths: [], weaknesses: [], changes: [], new_tactics: [] }`;
  
  try {
    const result = await botAICall(prompt, null, { max_tokens: 1500, temperature: 0.7 });
    const suggestions = extractJSON(result.text);
    
    if (suggestions) {
      await saveStrategyImprovement(strategyName, analysis, suggestions);
      return { analysis, suggestions };
    }
  } catch (err) {
    console.warn("[improvement] Strategy optimization failed:", err.message);
  }
  
  return { analysis, suggestions: null };
}

async function saveStrategyImprovement(strategyName, analysis, suggestions) {
  await fsp.mkdir(IMPROVEMENT_DIR, { recursive: true });
  
  let strategies = {};
  try {
    const data = await fsp.readFile(STRATEGIES_FILE, "utf8");
    strategies = JSON.parse(data);
  } catch {}
  
  if (!strategies[strategyName]) {
    strategies[strategyName] = {
      created_at: new Date().toISOString(),
      improvements: [],
    };
  }
  
  strategies[strategyName].improvements.push({
    timestamp: new Date().toISOString(),
    analysis,
    suggestions,
  });
  
  // Keep only last 50 improvements
  if (strategies[strategyName].improvements.length > 50) {
    strategies[strategyName].improvements = strategies[strategyName].improvements.slice(-50);
  }
  
  await fsp.writeFile(STRATEGIES_FILE, JSON.stringify(strategies, null, 2));
}

// ─── Parameter Auto-Tuning ───────────────────────────────────────────────────

async function loadParameters() {
  await fsp.mkdir(IMPROVEMENT_DIR, { recursive: true });
  
  try {
    const data = await fsp.readFile(PARAMETERS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    // Default parameters
    return {
      outreach: {
        daily_limit: 100,
        batch_size: 10,
        delay_between_batches: 5000,
        max_retries: 3,
      },
      discovery: {
        daily_limit: 500,
        priority_threshold: 0.5,
        sources: ["discord", "telegram", "moltbook"],
      },
      messaging: {
        personalization_level: 0.7,
        test_variants_percentage: 0.1,
        max_message_length: 500,
      },
      learning: {
        min_samples_for_insight: 10,
        confidence_threshold: 0.6,
        improvement_frequency: "daily",
      },
    };
  }
}

async function tuneParameters(performanceData) {
  const currentParams = await loadParameters();
  const tunedParams = { ...currentParams };
  
  // Analyze performance and adjust parameters
  const conversionRate = performanceData.conversion_rate || 0;
  const dailyConversions = performanceData.daily_conversions || 0;
  const targetDaily = 50; // Need ~50 conversions/day for 100k in 3 months
  
  // Adjust outreach parameters based on conversion rate
  if (conversionRate < 0.05) {
    // Low conversion - increase personalization
    tunedParams.messaging.personalization_level = Math.min(
      currentParams.messaging.personalization_level + 0.1,
      1.0
    );
    tunedParams.messaging.test_variants_percentage = Math.min(
      currentParams.messaging.test_variants_percentage + 0.05,
      0.3
    );
  } else if (conversionRate > 0.1) {
    // High conversion - can scale up
    tunedParams.outreach.daily_limit = Math.min(
      currentParams.outreach.daily_limit * 1.2,
      500
    );
  }
  
  // Adjust discovery based on daily conversions
  if (dailyConversions < targetDaily * 0.5) {
    // Need more leads
    tunedParams.discovery.daily_limit = Math.min(
      currentParams.discovery.daily_limit * 1.5,
      1000
    );
  }
  
  // Save tuned parameters
  await fsp.writeFile(PARAMETERS_FILE, JSON.stringify(tunedParams, null, 2));
  
  return {
    previous: currentParams,
    tuned: tunedParams,
    changes: Object.keys(tunedParams).filter(key => 
      JSON.stringify(tunedParams[key]) !== JSON.stringify(currentParams[key])
    ),
  };
}

// ─── Goal Tracking and Adjustment ───────────────────────────────────────────

async function trackGoalProgress() {
  const pool = await initDatabase();
  if (!pool) return null;
  
  try {
    // Get current revenue
    const revenueResult = await pool.query(`
      SELECT 
        COALESCE(SUM(value), 0) as total_revenue,
        COUNT(*) as total_conversions,
        COUNT(*) FILTER (WHERE converted_at >= NOW() - INTERVAL '24 hours') as conversions_today
      FROM bot_conversions
    `);
    
    const stats = revenueResult.rows[0];
    const goal = {
      target_credits: 100000, // $100k minimum
      target_days: 90, // 3 months
      current_credits: parseFloat(stats.total_revenue || 0),
      days_elapsed: getDaysElapsed(GOAL_START_DATE),
    };
    
    goal.progress_percent = (goal.current_credits / goal.target_credits * 100);
    goal.daily_needed = (goal.target_credits - goal.current_credits) / Math.max(1, goal.target_days - goal.days_elapsed);
    goal.daily_actual = parseFloat(stats.conversions_today || 0);
    goal.on_track = goal.daily_actual >= goal.daily_needed * 0.8; // 80% of needed is "on track"
    
    // Track performance
    await trackPerformance("goal_progress", goal.progress_percent, {
      current: goal.current_credits,
      target: goal.target_credits,
      daily_needed: goal.daily_needed,
      daily_actual: goal.daily_actual,
    });
    
    return goal;
  } catch (err) {
    console.error("[improvement] Goal tracking failed:", err.message);
    return null;
  }
}

// ─── Learning from Failures ──────────────────────────────────────────────────

async function learnFromFailures() {
  const pool = await initDatabase();
  if (!pool) return null;
  
  try {
    // Get recent failures
    const failuresResult = await pool.query(`
      SELECT 
        platform,
        message_variant,
        status,
        COUNT(*) as count,
        MAX(created_at) as last_occurrence
      FROM bot_outreach_results
      WHERE status IN ('rejected', 'ignored', 'failed')
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY platform, message_variant, status
      ORDER BY count DESC
      LIMIT 20
    `);
    
    if (failuresResult.rows.length === 0) return null;
    
    // Analyze failure patterns
    const patterns = {
      by_platform: {},
      by_variant: {},
      common_reasons: [],
    };
    
    for (const row of failuresResult.rows) {
      if (!patterns.by_platform[row.platform]) {
        patterns.by_platform[row.platform] = 0;
      }
      patterns.by_platform[row.platform] += parseInt(row.count);
      
      if (!patterns.by_variant[row.message_variant]) {
        patterns.by_variant[row.message_variant] = 0;
      }
      patterns.by_variant[row.message_variant] += parseInt(row.count);
    }
    
    // Get AI insights on failures
    const prompt = `Analyze these failure patterns and suggest improvements:

Failures by Platform:
${JSON.stringify(patterns.by_platform, null, 2)}

Failures by Message Variant:
${JSON.stringify(patterns.by_variant, null, 2)}

Top Failure Cases:
${JSON.stringify(failuresResult.rows.slice(0, 10), null, 2)}

Suggest:
1. Why these failures are happening
2. What to avoid
3. How to improve success rate
4. Specific changes to make

Return as JSON: { root_causes: [], avoid: [], improvements: [], changes: [] }`;
    
    try {
      const result = await botAICall(prompt, null, { max_tokens: 1500, temperature: 0.7 });
      const insights = extractJSON(result.text);
      
      if (insights) {
        await saveFailureInsights(patterns, insights);
        return { patterns, insights };
      }
    } catch (err) {
      console.warn("[improvement] Failure analysis failed:", err.message);
    }
    
    return { patterns, insights: null };
  } catch (err) {
    console.error("[improvement] Learning from failures failed:", err.message);
    return null;
  }
}

async function saveFailureInsights(patterns, insights) {
  await fsp.mkdir(IMPROVEMENT_DIR, { recursive: true });
  
  const failureFile = path.join(IMPROVEMENT_DIR, "failure-insights.json");
  let failures = [];
  
  try {
    const data = await fsp.readFile(failureFile, "utf8");
    failures = JSON.parse(data);
  } catch {}
  
  failures.push({
    timestamp: new Date().toISOString(),
    patterns,
    insights,
  });
  
  // Keep only last 50
  if (failures.length > 50) {
    failures = failures.slice(-50);
  }
  
  await fsp.writeFile(failureFile, JSON.stringify(failures, null, 2));
}

// ─── Auto-Improvement Cycle ───────────────────────────────────────────────────

async function runAutoImprovementCycle() {
  console.log("[improvement] Starting auto-improvement cycle...");
  
  // 1. Track goal progress
  const goal = await trackGoalProgress();
  if (goal) {
    console.log(`[improvement] Goal progress: ${Number(goal.progress_percent || 0).toFixed(1)}%`);
    console.log(`[improvement] Daily needed: $${Number(goal.daily_needed || 0).toFixed(2)}, actual: $${Number(goal.daily_actual || 0).toFixed(2)}`);
  }
  
  // 2. Learn from failures
  const failures = await learnFromFailures();
  if (failures && failures.insights) {
    console.log(`[improvement] Learned from ${Object.keys(failures.patterns.by_platform).length} failure patterns`);
  }
  
  // 3. Tune parameters
  const performanceData = {
    conversion_rate: goal ? (goal.daily_actual / Math.max(1, goal.daily_needed)) * 0.05 : 0.05,
    daily_conversions: goal ? goal.daily_actual : 0,
  };
  
  const tuning = await tuneParameters(performanceData);
  if (tuning.changes.length > 0) {
    console.log(`[improvement] Tuned parameters: ${tuning.changes.join(", ")}`);
  }
  
  // 4. Get performance trends
  const trends = {
    conversion: await getPerformanceTrend("conversion_rate", 7),
    revenue: await getPerformanceTrend("daily_revenue", 7),
  };
  
  for (const [metric, trend] of Object.entries(trends)) {
    if (trend) {
      const direction = trend.trend > 0 ? "↑" : trend.trend < 0 ? "↓" : "→";
      console.log(`[improvement] ${metric} trend: ${direction} ${(Math.abs(trend.trend) * 100).toFixed(1)}%`);
    }
  }
  
  return {
    goal,
    failures,
    tuning,
    trends,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  trackPerformance,
  getPerformanceTrend,
  optimizeStrategy,
  tuneParameters,
  loadParameters,
  trackGoalProgress,
  learnFromFailures,
  runAutoImprovementCycle,
};

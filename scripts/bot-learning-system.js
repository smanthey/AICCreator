#!/usr/bin/env node
"use strict";

/**
 * bot-learning-system.js — Learning and Improvement System
 * 
 * Continuously learns from outreach results to improve:
 * - Message effectiveness
 * - Conversion rates
 * - Best times to contact
 * - Platform preferences
 * - Message variations
 * 
 * Uses AI to analyze patterns and suggest improvements daily.
 */

require("dotenv").config({ override: true });

const fsp = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");
const { botAICall, extractJSON } = require("./bot-ai-helper");

const ROOT = path.join(__dirname, "..");
const LEARNING_DIR = path.join(ROOT, "agent-state", "bot-learning");
const LEARNING_DATA = path.join(LEARNING_DIR, "learning-data.json");

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
    
    // Learning tables
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
      CREATE TABLE IF NOT EXISTS bot_learning_insights (
        id UUID PRIMARY KEY,
        insight_type TEXT NOT NULL, -- message_effectiveness, timing, platform, etc.
        insight_data JSONB NOT NULL,
        confidence_score NUMERIC(5,2) DEFAULT 0,
        applied_at TIMESTAMPTZ,
        impact_score NUMERIC(5,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_outreach_bot_id ON bot_outreach_results(bot_id);
      CREATE INDEX IF NOT EXISTS idx_outreach_status ON bot_outreach_results(status);
      CREATE INDEX IF NOT EXISTS idx_outreach_variant ON bot_outreach_results(message_variant);
      CREATE INDEX IF NOT EXISTS idx_learning_type ON bot_learning_insights(insight_type);
    `);
  } catch (err) {
    console.warn("[learning] Database not available:", err.message);
    useDatabase = false;
  }
}

// ─── Analyze Outreach Results ──────────────────────────────────────────────

async function analyzeOutreachResults(days = 7) {
  await initDatabase();
  
  if (!useDatabase || !pool) {
    console.warn("[learning] Database not available for analysis");
    return null;
  }
  
  try {
    const result = await pool.query(`
      SELECT 
        message_variant,
        platform,
        COUNT(*) as total_sent,
        COUNT(*) FILTER (WHERE status = 'responded') as responded,
        COUNT(*) FILTER (WHERE status = 'converted') as converted,
        AVG(response_time_seconds) as avg_response_time,
        SUM(conversion_value) as total_value,
        AVG(EXTRACT(EPOCH FROM (responded_at - sent_at))) as avg_response_seconds
      FROM bot_outreach_results
      WHERE sent_at >= NOW() - INTERVAL '${days} days'
      GROUP BY message_variant, platform
      ORDER BY converted DESC, responded DESC
    `);
    
    return result.rows;
  } catch (err) {
    console.error("[learning] Analysis failed:", err.message);
    return null;
  }
}

// ─── Generate AI Insights ──────────────────────────────────────────────────

async function generateAIInsights(analysisData) {
  const prompt = `You are analyzing bot outreach results to improve conversion rates. Here's the data:

${JSON.stringify(analysisData, null, 2)}

Based on this data, provide:
1. Which message variants are most effective and why
2. Which platforms have best conversion rates
3. Optimal timing patterns (if available)
4. Specific recommendations for improving messages
5. Suggested new message variations to test

Format as JSON with:
{
  "top_variants": [...],
  "platform_insights": {...},
  "recommendations": [...],
  "new_variants_to_test": [...],
  "confidence": 0.0-1.0
}`;

  try {
    const result = await botAICall(prompt, null, {
      max_tokens: 2000,
      temperature: 0.7,
    });
    
    // Try to extract JSON from response
    const json = extractJSON(result.text);
    if (json) {
      return json;
    }
    
    return null;
  } catch (err) {
    console.error("[learning] AI insight generation failed:", err.message);
    return null;
  }
}

// ─── Save Insights ────────────────────────────────────────────────────────

async function saveInsight(insightType, insightData, confidence = 0.5) {
  await initDatabase();
  
  if (useDatabase && pool) {
    try {
      await pool.query(`
        INSERT INTO bot_learning_insights (
          insight_type, insight_data, confidence_score
        ) VALUES ($1, $2, $3)
      `, [
        insightType,
        JSON.stringify(insightData),
        confidence,
      ]);
    } catch (err) {
      console.error("[learning] Failed to save insight:", err.message);
    }
  }
  
  // Also save to file
  try {
    await fsp.mkdir(LEARNING_DIR, { recursive: true });
    let data = {};
    try {
      const existing = await fsp.readFile(LEARNING_DATA, "utf8");
      data = JSON.parse(existing);
    } catch {}
    
    if (!data.insights) data.insights = [];
    data.insights.push({
      type: insightType,
      data: insightData,
      confidence,
      created_at: new Date().toISOString(),
    });
    
    await fsp.writeFile(LEARNING_DATA, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[learning] Failed to save insight to file:", err.message);
  }
  
  // Also store in SQL memory for semantic search
  try {
    const sqlMemory = require("../control/agent-memory-sql");
    const insightText = typeof insightData === "string" 
      ? insightData 
      : JSON.stringify(insightData);
    
    await sqlMemory.storeMemory({
      agent_id: "bot_collection_autonomous",
      content: `[${insightType}] ${insightText}`,
      content_type: "insight",
      metadata: { insight_type: insightType, insight_data: insightData },
      tags: ["bot-collection", "learning", insightType],
      importance_score: confidence,
      verified: confidence >= 0.8,
    });
  } catch (err) {
    console.warn("[learning] SQL memory storage failed:", err.message);
  }
}

// ─── Get Best Performing Messages ──────────────────────────────────────────

async function getBestMessages(platform = null, limit = 5) {
  await initDatabase();
  
  if (!useDatabase || !pool) {
    return [];
  }
  
  try {
    let query = `
      SELECT 
        message_variant,
        platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'converted') as converted,
        (COUNT(*) FILTER (WHERE status = 'converted')::NUMERIC / COUNT(*)::NUMERIC) as conversion_rate
      FROM bot_outreach_results
      WHERE total >= 10
    `;
    
    const params = [];
    if (platform) {
      query += ` AND platform = $1`;
      params.push(platform);
    }
    
    query += `
      GROUP BY message_variant, platform
      HAVING COUNT(*) >= 10
      ORDER BY conversion_rate DESC, converted DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);
    
    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    console.error("[learning] Query failed:", err.message);
    return [];
  }
}

// ─── Daily Learning Cycle ─────────────────────────────────────────────────

async function runDailyLearning() {
  await initDatabase();
  
  console.log("=".repeat(60));
  console.log("🧠 Daily Learning Cycle");
  console.log("=".repeat(60));
  console.log();
  
  // Analyze last 7 days
  console.log("📊 Analyzing outreach results...");
  const analysis = await analyzeOutreachResults(7);
  
  if (!analysis || analysis.length === 0) {
    console.log("⚠️  No data to analyze yet. Start sending messages first.");
    return;
  }
  
  console.log(`   Found ${analysis.length} message variants to analyze`);
  
  // Generate AI insights
  console.log("\n🤖 Generating AI insights...");
  const insights = await generateAIInsights(analysis);
  
  if (insights) {
    console.log("   ✅ AI insights generated");
    console.log(`   Top variants: ${insights.top_variants?.length || 0}`);
    console.log(`   Recommendations: ${insights.recommendations?.length || 0}`);
    
    // Save insights
    await saveInsight("daily_analysis", insights, insights.confidence || 0.7);
    
    // Display key insights
    console.log("\n💡 Key Insights:");
    if (insights.top_variants) {
      console.log("   Best performing variants:");
      insights.top_variants.slice(0, 3).forEach((v, i) => {
        console.log(`     ${i + 1}. ${v.variant} (${(v.conversion_rate * 100).toFixed(1)}% conversion)`);
      });
    }
    
    if (insights.recommendations) {
      console.log("\n   Recommendations:");
      insights.recommendations.slice(0, 3).forEach((r, i) => {
        console.log(`     ${i + 1}. ${r}`);
      });
    }
  } else {
    console.log("   ⚠️  Could not generate AI insights");
  }
  
  // Get best messages
  console.log("\n📈 Best Performing Messages:");
  const bestMessages = await getBestMessages(null, 5);
  bestMessages.forEach((m, i) => {
    console.log(`   ${i + 1}. ${m.message_variant} (${m.platform})`);
    console.log(`      Conversion: ${(parseFloat(m.conversion_rate) * 100).toFixed(1)}% (${m.converted}/${m.total})`);
  });
  
  console.log("\n✅ Learning cycle complete");
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "learn";
  
  if (command === "learn") {
    await runDailyLearning();
  } else if (command === "analyze") {
    const days = args[1] ? parseInt(args[1]) : 7;
    const analysis = await analyzeOutreachResults(days);
    if (analysis) {
      console.log(JSON.stringify(analysis, null, 2));
    }
  } else if (command === "best") {
    const platform = args[1] || null;
    const messages = await getBestMessages(platform, 10);
    console.log(JSON.stringify(messages, null, 2));
  } else {
    console.log(`
bot-learning-system.js — Learning and Improvement System

Commands:
  node scripts/bot-learning-system.js learn          # Run daily learning cycle
  node scripts/bot-learning-system.js analyze [days] # Analyze results
  node scripts/bot-learning-system.js best [platform] # Get best messages
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
  runDailyLearning,
  analyzeOutreachResults,
  generateAIInsights,
  getBestMessages,
  saveInsight,
};

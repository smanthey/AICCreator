#!/usr/bin/env node
"use strict";

/**
 * bot-conversion-tracker.js — Conversion Tracking and Analytics
 * 
 * Tracks all conversions and provides analytics for:
 * - Conversion rates by platform, message variant, time
 * - Revenue tracking
 * - Funnel analysis
 * - Performance metrics
 */

require("dotenv").config({ override: true });

const { Pool } = require("pg");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ANALYTICS_DIR = path.join(ROOT, "agent-state", "bot-analytics");

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
    
    // Ensure all required tables exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_discovery_targets (
        id UUID PRIMARY KEY,
        bot_id TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        source TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS bot_outreach_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bot_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        message_variant TEXT NOT NULL,
        message_content TEXT,
        status TEXT DEFAULT 'sent',
        metadata JSONB DEFAULT '{}'::jsonb,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        responded_at TIMESTAMPTZ,
        converted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_conversions (
        id UUID PRIMARY KEY,
        bot_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        value NUMERIC(10,2) NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        converted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(bot_id, converted_at)
      )
    `);
  } catch (err) {
    console.warn("[tracker] Database not available:", err.message);
    useDatabase = false;
  }
}

// ─── Track Conversion ──────────────────────────────────────────────────────

async function trackConversion(botId, platform, value, metadata = {}) {
  await initDatabase();
  
  if (useDatabase && pool) {
    try {
      // Update outreach result (most recent one)
      await pool.query(`
        UPDATE bot_outreach_results
        SET status = 'converted',
            converted_at = NOW(),
            conversion_value = $1
        WHERE id = (
          SELECT id FROM bot_outreach_results
          WHERE bot_id = $2 AND status != 'converted'
          ORDER BY sent_at DESC
          LIMIT 1
        )
      `, [value, botId]);
      
      // Update discovery target
      await pool.query(`
        UPDATE bot_discovery_targets
        SET status = 'converted',
            converted_at = NOW()
        WHERE bot_id = $1
      `, [botId]);
      
      // Ensure conversions table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_conversions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          bot_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          value NUMERIC(10,2) NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          converted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(bot_id, converted_at)
        )
      `);
      
      // Log conversion
      await pool.query(`
        INSERT INTO bot_conversions (
          bot_id, platform, value, metadata, converted_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (bot_id, converted_at) DO NOTHING
      `, [botId, platform, value, JSON.stringify(metadata)]);
    } catch (err) {
      console.error("[tracker] Conversion tracking failed:", err.message);
    }
  }
  
  // Also log to file
  await logConversion(botId, platform, value, metadata);
}

// ─── Track Outreach Attempts ───────────────────────────────────────────────

async function trackOutreachAttempt({
  botId,
  platform,
  messageVariant,
  messageContent,
  status = "sent",
  metadata = {},
}) {
  await initDatabase();

  if (useDatabase && pool) {
    try {
      await pool.query(
        `
        INSERT INTO bot_outreach_attempts (
          bot_id, platform, message_variant, message_content, status, metadata, sent_at, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, NOW(), NOW()
        )
        `,
        [
          botId,
          platform,
          messageVariant || "unknown",
          messageContent || null,
          status,
          JSON.stringify(metadata || {}),
        ]
      );

      // Best-effort write to legacy table (may fail due strict FK graph).
      try {
        await pool.query(
          `
          INSERT INTO bot_outreach_results (
            id, bot_id, platform, message_variant, message_content, status, metadata, sent_at, created_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW()
          )
          `,
          [
            botId,
            platform,
            messageVariant || "unknown",
            messageContent || null,
            status,
            JSON.stringify(metadata || {}),
          ]
        );
      } catch {
        // ignore
      }
      return true;
    } catch (err) {
      console.error("[tracker] Outreach tracking failed:", err.message);
    }
  }

  // File fallback
  try {
    await fsp.mkdir(ANALYTICS_DIR, { recursive: true });
    const logFile = path.join(ANALYTICS_DIR, "outreach-results.jsonl");
    await fsp.appendFile(
      logFile,
      `${JSON.stringify({
        bot_id: botId,
        platform,
        message_variant: messageVariant || "unknown",
        message_content: messageContent || null,
        status,
        metadata: metadata || {},
        sent_at: new Date().toISOString(),
      })}\n`
    );
  } catch (err) {
    console.error("[tracker] Outreach fallback log failed:", err.message);
  }

  return false;
}

async function updateOutreachStatus({ botId, platform, status, metadata = {} }) {
  await initDatabase();

  if (useDatabase && pool) {
    try {
      await pool.query(
        `
        UPDATE bot_outreach_attempts
        SET status = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            responded_at = CASE WHEN $1 = 'responded' THEN NOW() ELSE responded_at END,
            converted_at = CASE WHEN $1 = 'converted' THEN NOW() ELSE converted_at END
        WHERE id = (
          SELECT id
          FROM bot_outreach_attempts
          WHERE bot_id = $3 AND platform = $4
          ORDER BY sent_at DESC
          LIMIT 1
        )
        `,
        [status, JSON.stringify(metadata || {}), botId, platform]
      );

      await pool.query(
        `
        UPDATE bot_outreach_results
        SET status = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            responded_at = CASE WHEN $1 = 'responded' THEN NOW() ELSE responded_at END,
            converted_at = CASE WHEN $1 = 'converted' THEN NOW() ELSE converted_at END
        WHERE id = (
          SELECT id
          FROM bot_outreach_results
          WHERE bot_id = $3 AND platform = $4
          ORDER BY sent_at DESC
          LIMIT 1
        )
        `,
        [status, JSON.stringify(metadata || {}), botId, platform]
      );
      return true;
    } catch (err) {
      console.error("[tracker] Outreach status update failed:", err.message);
    }
  }

  return false;
}

async function logConversion(botId, platform, value, metadata) {
  try {
    await fsp.mkdir(ANALYTICS_DIR, { recursive: true });
    const logFile = path.join(ANALYTICS_DIR, "conversions.jsonl");
    await fsp.appendFile(logFile, `${JSON.stringify({
      bot_id: botId,
      platform,
      value,
      metadata,
      converted_at: new Date().toISOString(),
    })}\n`);
  } catch (err) {
    console.error("[tracker] Log write failed:", err.message);
  }
}

// ─── Get Conversion Stats ─────────────────────────────────────────────────

async function getConversionStats(days = 30) {
  await initDatabase();
  
  if (!useDatabase || !pool) {
    return null;
  }
  
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT bot_id) as total_converted,
        SUM(conversion_value) as total_revenue,
        AVG(conversion_value) as avg_value,
        COUNT(*) FILTER (WHERE platform = 'discord') as discord_conversions,
        COUNT(*) FILTER (WHERE platform = 'telegram') as telegram_conversions,
        COUNT(*) FILTER (WHERE platform = 'moltbook') as moltbook_conversions,
        COUNT(*) FILTER (WHERE converted_at >= NOW() - INTERVAL '1 day') as conversions_today,
        COUNT(*) FILTER (WHERE converted_at >= NOW() - INTERVAL '7 days') as conversions_week
      FROM bot_outreach_results
      WHERE status = 'converted'
        AND converted_at >= NOW() - INTERVAL '${days} days'
    `);
    
    return result.rows[0] || null;
  } catch (err) {
    console.error("[tracker] Stats query failed:", err.message);
    return null;
  }
}

// ─── Get Funnel Metrics ────────────────────────────────────────────────────

async function getFunnelMetrics(days = 30) {
  await initDatabase();
  
  if (!useDatabase || !pool) {
    return null;
  }
  
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT bot_id) FILTER (WHERE status = 'discovered') as discovered,
        COUNT(DISTINCT bot_id) FILTER (WHERE status = 'contacted') as contacted,
        COUNT(DISTINCT bot_id) FILTER (WHERE status = 'responded') as responded,
        COUNT(DISTINCT bot_id) FILTER (WHERE status = 'converted') as converted,
        COUNT(DISTINCT bot_id) as total_targets
      FROM bot_discovery_targets
      WHERE discovered_at >= NOW() - INTERVAL '${days} days'
    `);
    
    const metrics = result.rows[0];
    if (metrics) {
      metrics.discovery_to_contact = metrics.discovered > 0 
        ? (metrics.contacted / metrics.discovered * 100).toFixed(2) 
        : 0;
      metrics.contact_to_response = metrics.contacted > 0 
        ? (metrics.responded / metrics.contacted * 100).toFixed(2) 
        : 0;
      metrics.response_to_conversion = metrics.responded > 0 
        ? (metrics.converted / metrics.responded * 100).toFixed(2) 
        : 0;
      metrics.overall_conversion = metrics.discovered > 0 
        ? (metrics.converted / metrics.discovered * 100).toFixed(2) 
        : 0;
    }
    
    return metrics;
  } catch (err) {
    console.error("[tracker] Funnel query failed:", err.message);
    return null;
  }
}

// ─── Get Revenue Projection ────────────────────────────────────────────────

async function getRevenueProjection() {
  const stats = await getConversionStats(30);
  const funnel = await getFunnelMetrics(30);
  
  if (!stats || !funnel) {
    return null;
  }
  
  // Calculate daily averages
  const dailyConversions = parseFloat(stats.conversions_week || 0) / 7;
  const avgValue = parseFloat(stats.avg_value || 0);
  const dailyRevenue = dailyConversions * avgValue;
  
  // Projections
  const weeklyRevenue = dailyRevenue * 7;
  const monthlyRevenue = dailyRevenue * 30;
  const quarterlyRevenue = dailyRevenue * 90;
  
  // With growth assumptions (5% week-over-week)
  let growthRevenue = monthlyRevenue;
  for (let week = 0; week < 12; week++) {
    growthRevenue += growthRevenue * 0.05;
  }
  const quarterlyGrowthRevenue = growthRevenue;
  
  return {
    current: {
      daily: dailyRevenue,
      weekly: weeklyRevenue,
      monthly: monthlyRevenue,
      quarterly: quarterlyRevenue,
    },
    with_growth: {
      quarterly: quarterlyGrowthRevenue,
    },
    metrics: {
      daily_conversions: dailyConversions.toFixed(2),
      avg_value: avgValue.toFixed(2),
      conversion_rate: parseFloat(funnel.overall_conversion || 0),
    },
  };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "stats";
  
  await initDatabase();
  
  if (command === "stats") {
    const days = args[1] ? parseInt(args[1]) : 30;
    const stats = await getConversionStats(days);
    if (stats) {
      console.log("=".repeat(60));
      console.log("📊 Conversion Statistics");
      console.log("=".repeat(60));
      console.log(`Total Converted: ${stats.total_converted}`);
      console.log(`Total Revenue: $${parseFloat(stats.total_revenue || 0).toFixed(2)}`);
      console.log(`Avg Value: $${parseFloat(stats.avg_value || 0).toFixed(2)}`);
      console.log(`\nBy Platform:`);
      console.log(`  Discord: ${stats.discord_conversions}`);
      console.log(`  Telegram: ${stats.telegram_conversions}`);
      console.log(`  Moltbook: ${stats.moltbook_conversions}`);
      console.log(`\nRecent:`);
      console.log(`  Today: ${stats.conversions_today}`);
      console.log(`  This Week: ${stats.conversions_week}`);
    }
  } else if (command === "funnel") {
    const days = args[1] ? parseInt(args[1]) : 30;
    const funnel = await getFunnelMetrics(days);
    if (funnel) {
      console.log("=".repeat(60));
      console.log("📈 Funnel Metrics");
      console.log("=".repeat(60));
      console.log(`Discovered: ${funnel.discovered}`);
      console.log(`Contacted: ${funnel.contacted} (${funnel.discovery_to_contact}%)`);
      console.log(`Responded: ${funnel.responded} (${funnel.contact_to_response}%)`);
      console.log(`Converted: ${funnel.converted} (${funnel.response_to_conversion}%)`);
      console.log(`\nOverall Conversion: ${funnel.overall_conversion}%`);
    }
  } else if (command === "projection") {
    const projection = await getRevenueProjection();
    if (projection) {
      console.log("=".repeat(60));
      console.log("💰 Revenue Projection");
      console.log("=".repeat(60));
      console.log(`Current Daily: $${projection.current.daily.toFixed(2)}`);
      console.log(`Current Weekly: $${projection.current.weekly.toFixed(2)}`);
      console.log(`Current Monthly: $${projection.current.monthly.toFixed(2)}`);
      console.log(`Current Quarterly: $${projection.current.quarterly.toFixed(2)}`);
      console.log(`\nWith 5% Weekly Growth:`);
      console.log(`  Quarterly: $${projection.with_growth.quarterly.toFixed(2)}`);
      console.log(`\nMetrics:`);
      console.log(`  Daily Conversions: ${projection.metrics.daily_conversions}`);
      console.log(`  Avg Value: $${projection.metrics.avg_value}`);
      console.log(`  Conversion Rate: ${projection.metrics.conversion_rate}%`);
    }
  } else {
    console.log(`
bot-conversion-tracker.js — Conversion Tracking and Analytics

Commands:
  node scripts/bot-conversion-tracker.js stats [days]      # Get conversion stats
  node scripts/bot-conversion-tracker.js funnel [days]    # Get funnel metrics
  node scripts/bot-conversion-tracker.js projection        # Get revenue projection
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
  trackConversion,
  trackOutreachAttempt,
  updateOutreachStatus,
  getConversionStats,
  getFunnelMetrics,
  getRevenueProjection,
};

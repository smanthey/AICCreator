#!/usr/bin/env node
"use strict";

/**
 * business-research-agent.js — Business Intelligence Research Agent
 * 
 * Discovers new business platform integrations, researches API documentation,
 * identifies authentication methods, tests API endpoints, and generates research
 * reports for the Builder Agent.
 */

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");
const { chatJson } = require("../infra/model-router");
const pg = require("../infra/postgres");
const { fetchWithFallback } = require("../scripts/agent-toolkit");

const AGENT_ID = "business_research_agent";

// ─── Load Agent Context ────────────────────────────────────────────────────

function loadContext(...files) {
  const contextDir = path.join(__dirname, "../context");
  return files.map(f => {
    try {
      const fpath = path.join(contextDir, f);
      return `\n---\n${fs.readFileSync(fpath, "utf8")}`;
    } catch (_) {
      return `\n--- [${f} not found] ---`;
    }
  }).join("\n");
}

// ─── Research System Prompt ─────────────────────────────────────────────────

const RESEARCH_SYSTEM = `You are the Business Intelligence Research Agent for OpenClaw.

Your mission: Discover new business platform integrations, research API documentation,
identify authentication methods, test API endpoints, and generate comprehensive research
reports for the Builder Agent.

## Research Process

1. **Platform Identification**: Identify platforms that should be integrated
   - E-commerce: Shopify, Etsy, Amazon
   - Payments: Stripe (extend), PayPal
   - Shipping: Shippo, PirateShip
   - Analytics: Google Analytics 4, Google Ads
   - Social: Facebook/Instagram, TikTok, Twitter/X, LinkedIn, YouTube
   - Communication: Email systems, SMS systems

2. **API Documentation Research**:
   - Find official API documentation URLs
   - Identify API version and endpoints
   - Document available data and operations
   - Note rate limits and constraints

3. **Authentication Research**:
   - Identify authentication method (OAuth, API key, webhook, etc.)
   - Document authentication flow
   - Note credential requirements

4. **Testing**:
   - Test API accessibility (if credentials available)
   - Verify endpoint responses
   - Check data format and structure

5. **Complexity Assessment**:
   - Rate integration complexity: simple, moderate, complex
   - Estimate build time in hours
   - Note any blockers or challenges

6. **Report Generation**:
   - Generate comprehensive research report
   - Store in business_integration_research table
   - Queue for Builder Agent

## Output Format

Return JSON:
{
  "platform": "platform_name",
  "api_documentation_url": "https://...",
  "authentication_method": "oauth|api_key|webhook|...",
  "api_endpoints": ["endpoint1", "endpoint2", ...],
  "rate_limits": {...},
  "data_available": ["orders", "products", "customers", ...],
  "integration_complexity": "simple|moderate|complex",
  "estimated_build_time_hours": 8,
  "research_notes": "detailed notes...",
  "blockers": ["blocker1", ...],
  "ready_for_build": true|false
}

${loadContext("SOUL.md", "USER.md", "AGENT_PRINCIPLES.md")}`;

// ─── Main Research Function ─────────────────────────────────────────────────

async function researchPlatform(platform) {
  console.log(`[research] Researching platform: ${platform}`);
  
  // Use AI to research the platform
  const prompt = `Research the ${platform} API integration. Find:
1. Official API documentation URL
2. Authentication method and requirements
3. Available endpoints and data
4. Rate limits and constraints
5. Integration complexity
6. Estimated build time

Platform: ${platform}`;

  try {
    const result = await chatJson(RESEARCH_SYSTEM, prompt, {
      max_tokens: 2000,
      temperature: 0.3,
    });

    if (result && result.platform) {
      // Store research findings in database
      await pg.query(
        `INSERT INTO business_integration_research 
         (platform, research_status, api_documentation_url, authentication_method, 
          api_endpoints, rate_limits, data_available, integration_complexity, 
          estimated_build_time_hours, research_notes, researcher_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (platform) DO UPDATE SET
           research_status = $2,
           api_documentation_url = $3,
           authentication_method = $4,
           api_endpoints = $5,
           rate_limits = $6,
           data_available = $7,
           integration_complexity = $8,
           estimated_build_time_hours = $9,
           research_notes = $10,
           updated_at = NOW()`,
        [
          result.platform || platform,
          result.ready_for_build ? "completed" : "in_progress",
          result.api_documentation_url || null,
          result.authentication_method || null,
          JSON.stringify(result.api_endpoints || []),
          JSON.stringify(result.rate_limits || {}),
          JSON.stringify(result.data_available || []),
          result.integration_complexity || "moderate",
          result.estimated_build_time_hours || 8,
          result.research_notes || "",
          AGENT_ID,
        ]
      );

      // If ready for build, queue it
      if (result.ready_for_build) {
        await pg.query(
          `INSERT INTO business_build_queue 
           (research_id, platform, build_status, build_priority)
           SELECT id, $1, 'queued', 5
           FROM business_integration_research
           WHERE platform = $1 AND research_status = 'completed'
           ON CONFLICT DO NOTHING`,
          [platform]
        );
      }

      return result;
    }
  } catch (err) {
    console.error(`[research] Error researching ${platform}:`, err.message);
    return null;
  }
}

// ─── Main Agent Function ────────────────────────────────────────────────────

async function main() {
  console.log(`[${AGENT_ID}] Starting research cycle`);

  // Load agent prelude (SOUL, MEMORY, context)
  const prelude = await loadAgentPrelude(AGENT_ID);
  console.log(`[${AGENT_ID}] Loaded prelude`);

  // Get platforms that need research
  const { rows: pendingResearch } = await pg.query(
    `SELECT DISTINCT platform 
     FROM business_data_sources 
     WHERE status = 'disconnected'
     AND platform NOT IN (SELECT platform FROM business_integration_research WHERE research_status = 'completed')
     ORDER BY platform
     LIMIT 5`
  );

  const platformsToResearch = pendingResearch.map(r => r.platform);
  
  // If no pending, research priority platforms
  if (platformsToResearch.length === 0) {
    const priorityPlatforms = [
      "shopify", "etsy", "amazon", "shippo", "pirateship",
      "google_analytics", "google_ads", "facebook_ads",
      "instagram", "tiktok", "twitter", "linkedin", "youtube"
    ];
    
    // Check which haven't been researched
    const { rows: researched } = await pg.query(
      `SELECT platform FROM business_integration_research WHERE research_status = 'completed'`
    );
    const researchedSet = new Set(researched.map(r => r.platform));
    
    platformsToResearch.push(...priorityPlatforms.filter(p => !researchedSet.has(p)));
  }

  console.log(`[${AGENT_ID}] Platforms to research: ${platformsToResearch.join(", ")}`);

  const results = [];
  for (const platform of platformsToResearch.slice(0, 3)) { // Limit to 3 per cycle
    const result = await researchPlatform(platform);
    if (result) {
      results.push({ platform, status: "completed" });
    } else {
      results.push({ platform, status: "failed" });
    }
  }

  // Log to daily memory
  const summary = `Researched ${results.length} platforms: ${results.map(r => `${r.platform} (${r.status})`).join(", ")}`;
  await appendAgentDailyLog(AGENT_ID, summary, { results });

  console.log(`[${AGENT_ID}] Research cycle complete: ${summary}`);
  return { ok: true, results };
}

// ─── Run ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[${AGENT_ID}] Fatal error:`, err);
      process.exit(1);
    });
}

module.exports = { main, researchPlatform };

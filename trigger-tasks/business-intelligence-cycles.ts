/**
 * business-intelligence-cycles.ts — Business Intelligence Agent Cycles
 * 
 * Trigger.dev scheduled tasks for autonomous business intelligence agent cycles:
 * - Research cycle (weekly)
 * - Build cycle (triggered by research)
 * - Update cycle (continuous monitoring)
 * - Improvement cycle (weekly)
 * - Coordination cycle (frequent)
 */

import { task, logger } from "@trigger.dev/sdk";
import { schedules } from "@trigger.dev/sdk";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Research Cycle Task ───────────────────────────────────────────────────

export const businessResearchCycle = task({
  id: "business-research-cycle",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async () => {
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("business-research-cycle starting");
    
    const { main: researchMain } = require("../agents/business-research-agent");
    const result = await researchMain();
    
    logger.info("business-research-cycle complete", { 
      platforms_researched: result.results?.length || 0 
    });
    
    return {
      ok: result.ok,
      platforms_researched: result.results?.length || 0,
      results: result.results || [],
    };
  },
});

// ─── Build Cycle Task ──────────────────────────────────────────────────────

export const businessBuildCycle = task({
  id: "business-build-cycle",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 60000,
  },
  run: async () => {
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("business-build-cycle starting");
    
    const { main: buildMain } = require("../agents/business-builder-agent");
    const result = await buildMain();
    
    logger.info("business-build-cycle complete", { 
      builds_completed: result.results?.filter((r: any) => r.ok).length || 0 
    });
    
    return {
      ok: result.ok,
      builds_completed: result.results?.filter((r: any) => r.ok).length || 0,
      results: result.results || [],
    };
  },
});

// ─── Update Cycle Task ──────────────────────────────────────────────────────

export const businessUpdateCycle = task({
  id: "business-update-cycle",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 60000,
  },
  run: async () => {
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("business-update-cycle starting");
    
    const { main: updateMain } = require("../agents/business-updater-agent");
    const result = await updateMain();
    
    logger.info("business-update-cycle complete", { 
      integrations_updated: result.updates?.filter((u: any) => u.ok).length || 0 
    });
    
    return {
      ok: result.ok,
      integrations_updated: result.updates?.filter((u: any) => u.ok).length || 0,
      total_integrations: result.total_integrations || 0,
    };
  },
});

// ─── Improvement Cycle Task ────────────────────────────────────────────────

export const businessImprovementCycle = task({
  id: "business-improvement-cycle",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30000,
  },
  run: async () => {
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("business-improvement-cycle starting");
    
    const { main: improveMain } = require("../agents/business-improver-agent");
    const result = await improveMain();
    
    logger.info("business-improvement-cycle complete", { 
      improvements_generated: result.improvements?.length || 0 
    });
    
    return {
      ok: result.ok,
      improvements_generated: result.improvements?.length || 0,
      issues_found: result.issues_found || 0,
    };
  },
});

// ─── Coordination Cycle Task ───────────────────────────────────────────────

export const businessCoordinationCycle = task({
  id: "business-coordination-cycle",
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async () => {
    const dotenv = require("dotenv");
    dotenv.config({ path: path.join(__dirname, "../.env") });
    
    logger.info("business-coordination-cycle starting");
    
    const { main: coordinateMain } = require("../agents/business-coordinator-agent");
    const result = await coordinateMain();
    
    logger.info("business-coordination-cycle complete", { 
      integrations_connected: result.status?.integrations?.connected || 0 
    });
    
    return {
      ok: result.ok,
      status: result.status,
      progress: result.progress,
    };
  },
});

// ─── Scheduled Tasks ────────────────────────────────────────────────────────

// Research cycle: Weekly on Monday at 2 AM UTC
export const weeklyResearchCycle = schedules.task({
  id: "weekly-business-research",
  cron: "0 2 * * 1", // Monday 2 AM UTC
  run: async (payload) => {
    logger.info("weekly-business-research triggered");
    const result = await businessResearchCycle.trigger({});
    return { triggered: true, runId: result.id };
  },
});

// Build cycle: Every 6 hours (15 minutes after research)
export const continuousBuildCycle = schedules.task({
  id: "continuous-business-build",
  cron: "15 */6 * * *", // Every 6 hours at :15
  run: async (payload) => {
    logger.info("continuous-business-build triggered");
    const result = await businessBuildCycle.trigger({});
    return { triggered: true, runId: result.id };
  },
});

// Update cycle: Every 6 hours (30 minutes after build)
export const continuousUpdateCycle = schedules.task({
  id: "continuous-business-update",
  cron: "30 */6 * * *", // Every 6 hours at :30
  run: async (payload) => {
    logger.info("continuous-business-update triggered");
    const result = await businessUpdateCycle.trigger({});
    return { triggered: true, runId: result.id };
  },
});

// Improvement cycle: Weekly on Wednesday at 3 AM UTC
export const weeklyImprovementCycle = schedules.task({
  id: "weekly-business-improvement",
  cron: "0 3 * * 3", // Wednesday 3 AM UTC
  run: async (payload) => {
    logger.info("weekly-business-improvement triggered");
    const result = await businessImprovementCycle.trigger({});
    return { triggered: true, runId: result.id };
  },
});

// Coordination cycle: Every 30 minutes
export const frequentCoordinationCycle = schedules.task({
  id: "frequent-business-coordination",
  cron: "*/30 * * * *", // Every 30 minutes
  run: async (payload) => {
    logger.info("frequent-business-coordination triggered");
    const result = await businessCoordinationCycle.trigger({});
    return { triggered: true, runId: result.id };
  },
});

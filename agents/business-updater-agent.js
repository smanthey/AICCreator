#!/usr/bin/env node
"use strict";

/**
 * business-updater-agent.js — Business Intelligence Updater Agent
 * 
 * Monitors API changes, updates deprecated endpoints, handles authentication
 * renewals, and fixes broken integrations.
 */

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");
const { chatJson } = require("../infra/model-router");
const pg = require("../infra/postgres");

const AGENT_ID = "business_updater_agent";

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

// ─── Updater System Prompt ────────────────────────────────────────────────

const UPDATER_SYSTEM = `You are the Business Intelligence Updater Agent for OpenClaw.

Your mission: Monitor API changes, update deprecated endpoints, handle authentication
renewals, and fix broken integrations.

## Update Process

1. **Health Check**: Monitor all integrations for errors and failures
2. **Change Detection**: Detect API version changes and deprecations
3. **Code Update**: Update code to handle API changes
4. **Auth Renewal**: Handle OAuth token refreshes and credential updates
5. **Error Recovery**: Fix broken integrations automatically

## Update Rules

- Test updates before deploying
- Maintain backward compatibility when possible
- Update error messages to be helpful
- Preserve existing functionality
- Follow established code patterns

${loadContext("SOUL.md", "USER.md", "AGENT_PRINCIPLES.md")}`;

// ─── Check Integration Health ──────────────────────────────────────────────

async function checkIntegrationHealth(platform) {
  // Check recent sync logs for errors
  const { rows: recentErrors } = await pg.query(
    `SELECT COUNT(*)::int AS error_count, MAX(started_at) AS last_error
     FROM business_sync_logs
     WHERE platform = $1 
     AND sync_status = 'failed'
     AND started_at > NOW() - INTERVAL '24 hours'`,
    [platform]
  );

  // Check data source status
  const { rows: source } = await pg.query(
    `SELECT status, last_sync_status, last_sync_error, last_sync_at
     FROM business_data_sources
     WHERE platform = $1`,
    [platform]
  );

  return {
    platform,
    error_count: recentErrors[0]?.error_count || 0,
    last_error: recentErrors[0]?.last_error,
    status: source[0]?.status,
    last_sync_status: source[0]?.last_sync_status,
    last_sync_error: source[0]?.last_sync_error,
    needs_update: (recentErrors[0]?.error_count || 0) > 0 || source[0]?.status === "error",
  };
}

// ─── Update Integration Function ────────────────────────────────────────────

async function updateIntegration(platform, issue) {
  console.log(`[updater] Updating integration: ${platform} - ${issue.type}`);

  // Read existing script
  const scriptPath = path.join(__dirname, "..", `scripts/business-${platform}-sync.js`);
  let existingCode = "";
  try {
    existingCode = await fs.promises.readFile(scriptPath, "utf8");
  } catch (err) {
    console.warn(`[updater] Could not read existing script: ${err.message}`);
  }

  const prompt = `Update the ${platform} integration to fix: ${issue.description}

Issue type: ${issue.type}
Error: ${issue.error || "N/A"}

Existing code:
\`\`\`javascript
${existingCode || "// No existing code"}
\`\`\`

Generate updated code that:
1. Fixes the issue
2. Maintains existing functionality
3. Follows established patterns
4. Handles errors gracefully`;

  try {
    const result = await chatJson(UPDATER_SYSTEM, prompt, {
      max_tokens: 3000,
      temperature: 0.2,
    });

    if (result && result.code) {
      // Write updated script
      await fs.promises.writeFile(scriptPath, result.code, "utf8");
      console.log(`[updater] Updated script: ${scriptPath}`);

      // Update data source status
      await pg.query(
        `UPDATE business_data_sources 
         SET status = 'connected', 
             last_sync_error = NULL,
             updated_at = NOW()
         WHERE platform = $1`,
        [platform]
      );

      return { ok: true, updated: true };
    }
  } catch (err) {
    console.error(`[updater] Error updating ${platform}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Main Agent Function ────────────────────────────────────────────────────

async function main() {
  console.log(`[${AGENT_ID}] Starting update cycle`);

  // Load agent prelude
  const prelude = await loadAgentPrelude(AGENT_ID);
  console.log(`[${AGENT_ID}] Loaded prelude`);

  // Get all connected integrations
  const { rows: integrations } = await pg.query(
    `SELECT platform FROM business_data_sources WHERE status = 'connected'`
  );

  const updates = [];
  for (const integration of integrations) {
    const health = await checkIntegrationHealth(integration.platform);
    
    if (health.needs_update) {
      const issue = {
        type: health.last_sync_error ? "sync_error" : "status_error",
        description: health.last_sync_error || `Status: ${health.status}`,
        error: health.last_sync_error,
      };
      
      const result = await updateIntegration(integration.platform, issue);
      updates.push({ platform: integration.platform, ...result });
    }
  }

  // Log to daily memory
  const summary = updates.length > 0 
    ? `Updated ${updates.filter(u => u.ok).length}/${updates.length} integrations: ${updates.map(u => `${u.platform} (${u.ok ? "ok" : "failed"})`).join(", ")}`
    : `All ${integrations.length} integrations healthy`;
  await appendAgentDailyLog(AGENT_ID, summary, { updates, total_integrations: integrations.length });

  console.log(`[${AGENT_ID}] Update cycle complete: ${summary}`);
  return { ok: true, updates, total_integrations: integrations.length };
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

module.exports = { main, checkIntegrationHealth, updateIntegration };

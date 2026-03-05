#!/usr/bin/env node
"use strict";

/**
 * scripts/semantic-log-pruner.js
 * 
 * Semantic Log Pruning - The "Memory" Problem
 * 
 * Problem: After 6 months, agent-state/ and logs/ folders become massive.
 * Reading a 50MB JSON file into memory every 5 minutes will crash Node.js scripts.
 * 
 * Solution: Every Sunday at 3 AM, summarize the week's logs into "Key Lessons Learned,"
 * append to history-bible.md, then DELETE the raw logs. Keep the "Wisdom" but lose the "Weight."
 */

require("dotenv").config({ override: true });

const fsp = require("fs/promises");
const path = require("path");
const { chat } = require("../infra/model-router");
const { listKnownAgents, agentDir, readText } = require("../control/agent-memory");

const ROOT = path.join(__dirname, "..");
const STATE_ROOT = path.join(ROOT, "agent-state");
const HISTORY_BIBLE = path.join(STATE_ROOT, "history-bible.md");

// Configuration
const KEEP_DAYS = 7; // Keep last 7 days of logs
const COMPRESS_ARCHIVES = true;

/**
 * Get week's logs for an agent
 */
async function getWeekLogs(agentId) {
  const memoryDir = path.join(agentDir(agentId), "memory");
  const archiveDir = path.join(agentDir(agentId), "archive");
  
  const logs = [];
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  
  // Read from memory directory
  try {
    const files = await fsp.readdir(memoryDir);
    for (const file of files) {
      if (!file.endsWith(".md") || file.startsWith("pruned-")) continue;
      
      const filePath = path.join(memoryDir, file);
      const stats = await fsp.stat(filePath);
      
      if (stats.mtimeMs < cutoff) {
        const content = readText(filePath, "");
        logs.push({
          file,
          date: file.replace(".md", ""),
          content,
          size: stats.size,
        });
      }
    }
  } catch (err) {
    console.warn(`[log-pruner] Could not read memory dir for ${agentId}:`, err.message);
  }
  
  return logs;
}

/**
 * Summarize week's logs using LLM
 */
async function summarizeWeekLogs(agentId, logs) {
  if (logs.length === 0) {
    return "No logs to summarize.";
  }
  
  const combinedLogs = logs
    .map(l => `[${l.date}]\n${l.content.slice(0, 2000)}`) // Limit each log to 2k chars
    .join("\n\n---\n\n");
  
  const summaryPrompt = `Summarize the following week's logs for agent "${agentId}" into key lessons learned. Focus on:
1. Important decisions and outcomes
2. Recurring patterns or issues
3. Successful strategies
4. Blockers and how they were resolved

Keep it concise (3-5 bullet points max).

Logs:
${combinedLogs.slice(0, 15000)}`; // Limit total to 15k chars

  try {
    const result = await chat("echo", "", summaryPrompt, {
      max_tokens: 500,
      timeout_ms: 60000,
    });
    
    return result.text.trim();
  } catch (err) {
    console.error(`[log-pruner] Summarization failed for ${agentId}:`, err.message);
    // Fallback: simple extraction
    return `Week summary for ${agentId}: ${logs.length} log files, ${logs.reduce((a, b) => a + b.size, 0)} bytes total.`;
  }
}

/**
 * Prune and summarize logs for an agent
 */
async function pruneAgentLogs(agentId) {
  console.log(`[log-pruner] Processing ${agentId}...`);
  
  const logs = await getWeekLogs(agentId);
  
  if (logs.length === 0) {
    return {
      agent_id: agentId,
      pruned: false,
      reason: "No logs to prune",
    };
  }
  
  const totalSize = logs.reduce((a, b) => a + b.size, 0);
  console.log(`[log-pruner] Found ${logs.length} log files (${(totalSize / 1024).toFixed(1)}KB) to prune`);
  
  // Summarize
  const summary = await summarizeWeekLogs(agentId, logs);
  
  // Append to history bible
  const bibleEntry = `## ${new Date().toISOString().split("T")[0]} - ${agentId}\n\n${summary}\n\n`;
  await fsp.appendFile(HISTORY_BIBLE, bibleEntry);
  
  // Archive or delete old logs
  const memoryDir = path.join(agentDir(agentId), "memory");
  const archiveDir = path.join(agentDir(agentId), "archive");
  await fsp.mkdir(archiveDir, { recursive: true });
  
  let archived = 0;
  let deleted = 0;
  
  for (const log of logs) {
    const from = path.join(memoryDir, log.file);
    const to = path.join(archiveDir, log.file);
    
    try {
      if (COMPRESS_ARCHIVES) {
        // Move to archive
        await fsp.rename(from, to);
        // Compress with gzip
        const { execSync } = require("child_process");
        try {
          execSync(`gzip -f "${to}"`, { stdio: "ignore", timeout: 5000 });
        } catch {
          // gzip not available, that's okay
        }
        archived++;
      } else {
        // Just delete
        await fsp.unlink(from);
        deleted++;
      }
    } catch (err) {
      console.warn(`[log-pruner] Failed to process ${log.file}:`, err.message);
    }
  }
  
  return {
    agent_id: agentId,
    pruned: true,
    logs_processed: logs.length,
    total_size_kb: (totalSize / 1024).toFixed(1),
    archived,
    deleted,
    summary_length: summary.length,
  };
}

/**
 * Main pruning function
 */
async function pruneAllLogs() {
  console.log("[log-pruner] Starting semantic log pruning...\n");
  
  // Ensure history bible exists
  await fsp.mkdir(path.dirname(HISTORY_BIBLE), { recursive: true });
  if (!(await fsp.access(HISTORY_BIBLE).then(() => true).catch(() => false))) {
    await fsp.writeFile(HISTORY_BIBLE, "# History Bible\n\nWeekly summaries of agent learnings.\n\n");
  }
  
  const agents = listKnownAgents();
  console.log(`[log-pruner] Processing ${agents.length} agents...\n`);
  
  const results = [];
  for (const agentId of agents) {
    try {
      const result = await pruneAgentLogs(agentId);
      results.push(result);
      
      if (result.pruned) {
        console.log(`  ✅ ${agentId}: ${result.logs_processed} logs, ${result.total_size_kb}KB`);
      }
    } catch (err) {
      console.error(`  ❌ ${agentId}: ${err.message}`);
      results.push({
        agent_id: agentId,
        pruned: false,
        error: err.message,
      });
    }
  }
  
  // Summary
  const totalPruned = results.filter(r => r.pruned).length;
  const totalLogs = results.reduce((a, b) => a + (b.logs_processed || 0), 0);
  const totalSize = results.reduce((a, b) => a + parseFloat(b.total_size_kb || 0), 0);
  
  console.log(`\n[log-pruner] Summary:`);
  console.log(`  Agents processed: ${totalPruned}/${agents.length}`);
  console.log(`  Total logs pruned: ${totalLogs}`);
  console.log(`  Total size freed: ${totalSize.toFixed(1)}KB`);
  console.log(`  History bible: ${HISTORY_BIBLE}`);
  
  return results;
}

if (require.main === module) {
  pruneAllLogs()
    .then(() => {
      console.log("\n[log-pruner] Complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[log-pruner] Fatal:", err);
      process.exit(1);
    });
}

module.exports = { pruneAllLogs, pruneAgentLogs };

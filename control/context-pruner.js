"use strict";

/**
 * control/context-pruner.js
 * 
 * VRAM Garbage Collector - Context Pruning
 * 
 * Problem: Ollama keeps models loaded in VRAM. As agents run long-tail research
 * or complex SaaS dev tasks, the Context Window fills with "Reasoning Noise."
 * Eventually, the model hallucinates because 80% of memory is old logs.
 * 
 * Solution: If agent history exceeds 4,000 tokens, trigger a "Summarization Event."
 * Agent pauses, sends history to a smaller model (phi-4 or mistral-nemo), gets a
 * 3-sentence summary, and replaces the history with that summary.
 */

const { chat } = require("../infra/model-router");
const { loadAgentPrelude, agentDir, todayLogPath, readText } = require("./agent-memory");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATE_ROOT = path.join(ROOT, "agent-state");

// Token estimation (rough: 1 token ≈ 4 characters for English)
const TOKENS_PER_CHAR = 0.25;
const CONTEXT_THRESHOLD_TOKENS = 4000;
const SUMMARIZATION_MODEL = "ollama_llama3"; // Fast + stable summarization baseline

/**
 * Estimate token count for text
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Check if agent context needs pruning
 */
async function needsPruning(agentId) {
  try {
    const prelude = await loadAgentPrelude(agentId, { maxChars: Infinity });
    const tokenCount = estimateTokens(prelude.text);
    
    return {
      needs_pruning: tokenCount > CONTEXT_THRESHOLD_TOKENS,
      token_count: tokenCount,
      threshold: CONTEXT_THRESHOLD_TOKENS,
      excess_tokens: Math.max(0, tokenCount - CONTEXT_THRESHOLD_TOKENS),
    };
  } catch (err) {
    console.warn(`[context-pruner] Failed to check pruning for ${agentId}:`, err.message);
    return {
      needs_pruning: false,
      error: err.message,
    };
  }
}

/**
 * Summarize agent history using a small, fast model
 */
async function summarizeHistory(agentId, historyText) {
  const summaryPrompt = `Summarize the following agent history into 3 concise sentences. Focus on:
1. Key decisions and outcomes
2. Important learnings or blockers
3. Current state and next actions

History:
${historyText.slice(-8000)}`; // Last 8k chars to stay within model limits

  try {
    const result = await chat("echo", "", summaryPrompt, {
      max_tokens: 200,
      timeout_ms: 30000,
      force_model: SUMMARIZATION_MODEL,
    });
    
    return result.text.trim();
  } catch (err) {
    console.error(`[context-pruner] Summarization failed for ${agentId}:`, err.message);
    // Fallback: just truncate
    return historyText.slice(0, 1000) + "\n\n[History truncated due to summarization failure]";
  }
}

/**
 * Prune agent context by summarizing old history
 */
async function pruneContext(agentId) {
  console.log(`[context-pruner] Pruning context for ${agentId}...`);
  
  const check = await needsPruning(agentId);
  if (!check.needs_pruning) {
    return {
      pruned: false,
      reason: "Context within limits",
      token_count: check.token_count,
    };
  }
  
  console.log(`[context-pruner] Context exceeds threshold: ${check.token_count} tokens (threshold: ${check.threshold})`);
  
  // Load full prelude to get history
  const prelude = await loadAgentPrelude(agentId, { maxChars: Infinity });
  
  // Extract history from memory files (not SOUL, USER, or MEMORY)
  const aDir = agentDir(agentId);
  const memoryDir = path.join(aDir, "memory");
  
  let historyText = "";
  try {
    const files = await fsp.readdir(memoryDir);
    const memoryFiles = files
      .filter(f => f.endsWith(".md"))
      .sort()
      .reverse(); // Most recent first
    
    // Load last 7 days of memory
    for (const file of memoryFiles.slice(0, 7)) {
      const filePath = path.join(memoryDir, file);
      const content = readText(filePath, "");
      historyText += `\n[${file}]\n${content}\n`;
    }
  } catch (err) {
    console.warn(`[context-pruner] Could not read memory files:`, err.message);
  }
  
  if (!historyText.trim()) {
    return {
      pruned: false,
      reason: "No history to prune",
    };
  }
  
  // Summarize history
  console.log(`[context-pruner] Summarizing ${historyText.length} chars of history...`);
  const summary = await summarizeHistory(agentId, historyText);
  
  // Create a pruned history file
  const prunedHistoryPath = path.join(memoryDir, `pruned-${new Date().toISOString().split("T")[0]}.md`);
  await fsp.mkdir(memoryDir, { recursive: true });
  await fsp.writeFile(
    prunedHistoryPath,
    `# Pruned History - ${new Date().toISOString()}\n\n## Summary\n${summary}\n\n## Original History\n[Truncated - see archive/ for full history]\n`
  );
  
  // Archive old memory files (keep only today and yesterday)
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const archiveDir = path.join(aDir, "archive");
  await fsp.mkdir(archiveDir, { recursive: true });
  
  try {
    const files = await fsp.readdir(memoryDir);
    let archived = 0;
    for (const file of files) {
      if (!file.endsWith(".md") || file.startsWith("pruned-")) continue;
      const fileDate = file.replace(".md", "");
      if (fileDate !== today && fileDate !== yesterday) {
        const from = path.join(memoryDir, file);
        const to = path.join(archiveDir, file);
        try {
          await fsp.rename(from, to);
          archived++;
        } catch (err) {
          console.warn(`[context-pruner] Could not archive ${file}:`, err.message);
        }
      }
    }
    
    console.log(`[context-pruner] Archived ${archived} old memory files`);
  } catch (err) {
    console.warn(`[context-pruner] Archive operation failed:`, err.message);
  }
  
  // Verify pruning worked
  const afterCheck = await needsPruning(agentId);
  
  return {
    pruned: true,
    token_count_before: check.token_count,
    token_count_after: afterCheck.token_count,
    tokens_saved: check.token_count - afterCheck.token_count,
    summary_length: summary.length,
    archived_files: archived || 0,
  };
}

/**
 * Check all agents and prune those that need it
 */
async function pruneAllAgents() {
  const { listKnownAgents } = require("./agent-memory");
  const agents = listKnownAgents();
  
  const results = [];
  for (const agentId of agents) {
    try {
      const result = await pruneContext(agentId);
      results.push({
        agent_id: agentId,
        ...result,
      });
    } catch (err) {
      results.push({
        agent_id: agentId,
        pruned: false,
        error: err.message,
      });
    }
  }
  
  return results;
}

module.exports = {
  needsPruning,
  pruneContext,
  pruneAllAgents,
  estimateTokens,
  CONTEXT_THRESHOLD_TOKENS,
};

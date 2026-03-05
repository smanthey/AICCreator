"use strict";

/**
 * control/cross-agent-learning.js
 * 
 * Cross-agent learning system using shared context store.
 * Agents emit signals that other agents can subscribe to and learn from.
 */

const redis = require("../infra/redis");
const { atomicAppendJSONL } = require("./atomic-state");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SIGNALS_LOG = path.join(ROOT, "agent-state", "agent-signals.ndjson");

// Redis keys
const SHARED_KNOWLEDGE_KEY = "shared_knowledge";
const SIGNAL_QUEUE_KEY = "agent_signals";
const SIGNAL_TTL_SECONDS = 3600; // Signals expire after 1 hour

// ─── Emit Signal ───────────────────────────────────────────────────────────────

/**
 * Emit a signal that other agents can learn from
 */
async function emitSignal({
  origin_agent_id,
  entities_touched = [],
  sentiment = "neutral", // "positive", "negative", "neutral"
  error_type = null,
  metadata = {},
  priority = "normal", // "low", "normal", "high", "critical"
}) {
  const signal = {
    id: `sig_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    origin_agent_id,
    entities_touched: Array.isArray(entities_touched) ? entities_touched : [entities_touched],
    sentiment,
    error_type,
    metadata,
    priority,
  };
  
  // Store in Redis for fast access
  try {
    const client = redis.getClient ? redis.getClient() : redis;
    
    // Add to signal queue (list)
    await client.lpush(SIGNAL_QUEUE_KEY, JSON.stringify(signal));
    await client.ltrim(SIGNAL_QUEUE_KEY, 0, 999); // Keep last 1000 signals
    await client.expire(SIGNAL_QUEUE_KEY, SIGNAL_TTL_SECONDS);
    
    // Update shared knowledge store
    await updateSharedKnowledge(signal);
  } catch (err) {
    console.warn("[cross-agent-learning] Redis unavailable, logging to file only:", err.message);
  }
  
  // Also log to file for persistence
  await atomicAppendJSONL(SIGNALS_LOG, signal);
  
  return signal;
}

// ─── Update Shared Knowledge ──────────────────────────────────────────────────

async function updateSharedKnowledge(signal) {
  try {
    const client = redis.getClient ? redis.getClient() : redis;
    
    // Get current knowledge
    const current = await client.get(SHARED_KNOWLEDGE_KEY);
    let knowledge = current ? JSON.parse(current) : {
      entities: {}, // entity -> { sentiment, error_types, affected_agents, last_seen }
      error_patterns: {}, // error_type -> { count, affected_agents, first_seen, last_seen }
      agent_insights: {}, // agent_id -> { common_errors, entities_worked_on, success_rate }
      last_updated: new Date().toISOString(),
    };
    
    // Update entity knowledge
    for (const entity of signal.entities_touched || []) {
      if (!knowledge.entities[entity]) {
        knowledge.entities[entity] = {
          sentiment: signal.sentiment,
          error_types: [],
          affected_agents: [],
          last_seen: signal.timestamp,
        };
      }
      
      knowledge.entities[entity].last_seen = signal.timestamp;
      if (signal.sentiment === "negative" && !knowledge.entities[entity].sentiment.includes("negative")) {
        knowledge.entities[entity].sentiment = "negative";
      }
      if (signal.error_type && !knowledge.entities[entity].error_types.includes(signal.error_type)) {
        knowledge.entities[entity].error_types.push(signal.error_type);
      }
      if (!knowledge.entities[entity].affected_agents.includes(signal.origin_agent_id)) {
        knowledge.entities[entity].affected_agents.push(signal.origin_agent_id);
      }
    }
    
    // Update error pattern knowledge
    if (signal.error_type) {
      if (!knowledge.error_patterns[signal.error_type]) {
        knowledge.error_patterns[signal.error_type] = {
          count: 0,
          affected_agents: [],
          first_seen: signal.timestamp,
          last_seen: signal.timestamp,
        };
      }
      
      knowledge.error_patterns[signal.error_type].count += 1;
      knowledge.error_patterns[signal.error_type].last_seen = signal.timestamp;
      if (!knowledge.error_patterns[signal.error_type].affected_agents.includes(signal.origin_agent_id)) {
        knowledge.error_patterns[signal.error_type].affected_agents.push(signal.origin_agent_id);
      }
    }
    
    // Update agent insights
    if (!knowledge.agent_insights[signal.origin_agent_id]) {
      knowledge.agent_insights[signal.origin_agent_id] = {
        common_errors: {},
        entities_worked_on: [],
        signal_count: 0,
      };
    }
    
    knowledge.agent_insights[signal.origin_agent_id].signal_count += 1;
    if (signal.error_type) {
      knowledge.agent_insights[signal.origin_agent_id].common_errors[signal.error_type] =
        (knowledge.agent_insights[signal.origin_agent_id].common_errors[signal.error_type] || 0) + 1;
    }
    for (const entity of signal.entities_touched || []) {
      if (!knowledge.agent_insights[signal.origin_agent_id].entities_worked_on.includes(entity)) {
        knowledge.agent_insights[signal.origin_agent_id].entities_worked_on.push(entity);
      }
    }
    
    knowledge.last_updated = new Date().toISOString();
    
    // Save back to Redis
    await client.set(SHARED_KNOWLEDGE_KEY, JSON.stringify(knowledge), "EX", 86400); // 24 hour TTL
  } catch (err) {
    console.warn("[cross-agent-learning] Failed to update shared knowledge:", err.message);
  }
}

// ─── Get Relevant Signals ─────────────────────────────────────────────────────

/**
 * Get signals relevant to an agent
 * Filters by entities, error types, or other agents
 */
async function getRelevantSignals({
  agent_id,
  entities = [],
  error_types = [],
  lookback_minutes = 60,
  priority_min = "normal",
}) {
  try {
    const client = redis.getClient ? redis.getClient() : redis;
    
    // Get recent signals from queue
    const signalsRaw = await client.lrange(SIGNAL_QUEUE_KEY, 0, 100);
    const cutoff = Date.now() - (lookback_minutes * 60 * 1000);
    
    const priorityRank = { low: 1, normal: 2, high: 3, critical: 4 };
    const minRank = priorityRank[priority_min] || priorityRank.normal;
    const signals = signalsRaw
      .map(s => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(s => s && new Date(s.timestamp).getTime() > cutoff)
      .filter(s => {
        // Filter by priority
        if ((priorityRank[s.priority] || priorityRank.normal) < minRank) {
          return false;
        }

        // Agent-specific view: ignore own signals unless explicitly critical
        if (agent_id && s.origin_agent_id === agent_id && s.priority !== "critical") {
          return false;
        }
        
        // Filter by entities
        if (entities.length > 0) {
          const hasEntity = s.entities_touched.some(e => entities.includes(e));
          if (!hasEntity) return false;
        }
        
        // Filter by error types
        if (error_types.length > 0) {
          if (!s.error_type || !error_types.includes(s.error_type)) return false;
        }
        
        return true;
      });
    
    return signals;
  } catch (err) {
    console.warn("[cross-agent-learning] Failed to get signals, falling back to file:", err.message);
    
    // Fallback to file
    try {
      const content = await fsp.readFile(SIGNALS_LOG, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      const cutoff = Date.now() - (lookback_minutes * 60 * 1000);
      
      const priorityRank = { low: 1, normal: 2, high: 3, critical: 4 };
      const minRank = priorityRank[priority_min] || priorityRank.normal;
      return lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(s => s && new Date(s.timestamp).getTime() > cutoff)
        .filter(s => {
          if ((priorityRank[s.priority] || priorityRank.normal) < minRank) {
            return false;
          }
          if (agent_id && s.origin_agent_id === agent_id && s.priority !== "critical") {
            return false;
          }
          if (entities.length > 0) {
            return s.entities_touched.some(e => entities.includes(e));
          }
          if (error_types.length > 0) {
            return !!s.error_type && error_types.includes(s.error_type);
          }
          return true;
        });
    } catch {
      return [];
    }
  }
}

// ─── Get Shared Knowledge ──────────────────────────────────────────────────────

async function getSharedKnowledge() {
  try {
    const client = redis.getClient ? redis.getClient() : redis;
    const data = await client.get(SHARED_KNOWLEDGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// ─── Adaptive Thresholds ──────────────────────────────────────────────────────

/**
 * Get adaptive thresholds based on shared knowledge
 * Example: If multiple agents report high LLM latency, lower concurrency globally
 */
async function getAdaptiveThresholds() {
  const knowledge = await getSharedKnowledge();
  if (!knowledge) {
    return {
      concurrency_limit: null,
      rate_limit: null,
      timeout_multiplier: 1.0,
    };
  }
  
  const thresholds = {
    concurrency_limit: null,
    rate_limit: null,
    timeout_multiplier: 1.0,
  };
  
  // Check for high latency patterns
  const latencyErrors = Object.entries(knowledge.error_patterns || {})
    .filter(([error, data]) => error.includes("latency") || error.includes("timeout"))
    .sort((a, b) => b[1].count - a[1].count);
  
  if (latencyErrors.length > 0 && latencyErrors[0][1].count >= 3) {
    // Multiple agents reporting latency issues
    thresholds.concurrency_limit = "reduced"; // Signal to reduce concurrency
    thresholds.timeout_multiplier = 1.5; // Increase timeouts
  }
  
  // Check for rate limit errors
  const rateLimitErrors = Object.entries(knowledge.error_patterns || {})
    .filter(([error]) => error.includes("rate_limit") || error.includes("429"));
  
  if (rateLimitErrors.length > 0 && rateLimitErrors[0][1].count >= 2) {
    thresholds.rate_limit = "reduced"; // Signal to reduce rate
  }
  
  return thresholds;
}

// ─── Cross-Pollination ────────────────────────────────────────────────────────

/**
 * Cross-pollinate signals to relevant agents
 * Automatically bumps priority or triggers actions based on signals
 */
async function crossPollinateSignals() {
  const knowledge = await getSharedKnowledge();
  if (!knowledge) return [];
  
  const actions = [];
  
  // Example: If SaaS Dev agent finds rate_limit_exceeded, bump Affiliate Research priority
  const rateLimitSignals = Object.entries(knowledge.error_patterns || {})
    .filter(([error]) => error.includes("rate_limit"));
  
  if (rateLimitSignals.length > 0) {
    // Find agents that also hit external APIs
    const apiAgents = ["affiliate_research", "research_analysis", "marketing_social"];
    for (const agentId of apiAgents) {
      actions.push({
        agent_id: agentId,
        action: "increase_priority",
        reason: "Rate limit errors detected in system",
        priority_boost: 0.2,
      });
    }
  }
  
  // Example: If negative sentiment on entity, trigger health check
  const negativeEntities = Object.entries(knowledge.entities || {})
    .filter(([_, data]) => data.sentiment === "negative");
  
  if (negativeEntities.length > 0) {
    actions.push({
      agent_id: "system_administration",
      action: "trigger_health_check",
      reason: `Negative signals on entities: ${negativeEntities.map(([e]) => e).join(", ")}`,
      entities: negativeEntities.map(([e]) => e),
    });
  }
  
  return actions;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  emitSignal,
  getRelevantSignals,
  getSharedKnowledge,
  getAdaptiveThresholds,
  crossPollinateSignals,
  updateSharedKnowledge,
};

"use strict";

/**
 * control/cost-coordinator.js
 * 
 * Economic Metabolism - Token & API Governance
 * 
 * Purpose: Circuit breaker for spend. Every agent must "request a budget" 
 * from the coordinator before a run. Prevents deterministic loops from 
 * burning through API credits.
 * 
 * Example:
 *   Agent: "I need to run 5,000 tokens on GPT-4o."
 *   Coordinator: "Daily budget is 90% full. Downgrade to Gemini Flash or wait until tomorrow."
 * 
 * Why: Capital is a resource just like Memory. In an LLM-heavy world, 
 * we need proactive budget governance, not reactive error throwing.
 */

const pg = require("../infra/postgres");
const redis = require("../infra/redis");
const { todaySpend, spendSummary, DAILY_CAP, PLAN_CAP } = require("./budget");
const { notifyMonitoring } = require("./monitoring-notify");

// Budget state cache (refreshed every 30 seconds)
let budgetCache = {
  last_refresh: 0,
  daily_spent: 0,
  daily_cap: DAILY_CAP,
  plan_cap: PLAN_CAP,
  provider_budgets: {},
  blocked_requests: 0,
};

const BUDGET_CACHE_TTL_MS = 30000; // 30 seconds

// Provider-specific daily budgets (from env or defaults)
const PROVIDER_BUDGETS = {
  openai: parseFloat(process.env.OPENAI_DAILY_BUDGET_USD || "10"),
  deepseek: parseFloat(process.env.DEEPSEEK_DAILY_BUDGET_USD || "8"),
  gemini: parseFloat(process.env.GEMINI_DAILY_BUDGET_USD || "8"),
  anthropic: parseFloat(process.env.ANTHROPIC_DAILY_BUDGET_USD || "12"),
  ollama: Infinity, // Free
};

// Model cost estimates (per 1k tokens, [input, output])
const MODEL_COSTS = {
  "gpt-4o-mini": { provider: "openai", cost: [0.00015, 0.0006] },
  "gpt-4o": { provider: "openai", cost: [0.002, 0.008] },
  "deepseek-chat": { provider: "deepseek", cost: [0.00014, 0.00028] },
  "deepseek-reasoner": { provider: "deepseek", cost: [0.00055, 0.0022] },
  "gemini-2.0-flash": { provider: "gemini", cost: [0.000075, 0.0003] },
  "gemini-2.5-pro": { provider: "gemini", cost: [0.00125, 0.005] },
  "claude-haiku-4-5-20251001": { provider: "anthropic", cost: [0.00025, 0.00125] },
  "claude-sonnet-4-6": { provider: "anthropic", cost: [0.003, 0.015] },
  "claude-opus-4-6": { provider: "anthropic", cost: [0.015, 0.075] },
};

/**
 * Estimate cost for a model call
 */
function estimateCost(modelId, estimatedTokensIn, estimatedTokensOut) {
  const modelInfo = MODEL_COSTS[modelId];
  if (!modelInfo) {
    // Default to conservative estimate if unknown
    return {
      provider: "unknown",
      cost_usd: (estimatedTokensIn + estimatedTokensOut) * 0.001, // $0.001 per token
      confidence: "low",
    };
  }
  
  const costIn = (estimatedTokensIn / 1000) * modelInfo.cost[0];
  const costOut = (estimatedTokensOut / 1000) * modelInfo.cost[1];
  const totalCost = costIn + costOut;
  
  return {
    provider: modelInfo.provider,
    cost_usd: totalCost,
    confidence: "high",
  };
}

/**
 * Refresh budget cache from Redis/DB
 */
async function refreshBudgetCache() {
  const now = Date.now();
  if (now - budgetCache.last_refresh < BUDGET_CACHE_TTL_MS) {
    return budgetCache; // Use cached value
  }
  
  try {
    const spent = await todaySpend();
    const summary = await spendSummary();
    
    // Get provider-specific spending from model_usage table
    const { rows } = await pg.query(
      `SELECT 
         provider,
         COALESCE(SUM(cost_usd), 0)::numeric AS spent
       FROM model_usage
       WHERE created_at >= date_trunc('day', now())
       GROUP BY provider`
    );
    
    const providerSpent = {};
    for (const row of rows) {
      providerSpent[row.provider] = parseFloat(row.spent);
    }
    
    // Get blocked requests count from today
    const { rows: blockedRows } = await pg.query(
      `SELECT COUNT(*)::int AS count
       FROM cost_coordinator_blocks
       WHERE created_at >= date_trunc('day', now())`
    );
    
    budgetCache = {
      last_refresh: now,
      daily_spent: spent,
      daily_cap: DAILY_CAP,
      plan_cap: PLAN_CAP,
      provider_budgets: Object.keys(PROVIDER_BUDGETS).reduce((acc, provider) => {
        acc[provider] = {
          spent: providerSpent[provider] || 0,
          cap: PROVIDER_BUDGETS[provider],
          remaining: Math.max(0, PROVIDER_BUDGETS[provider] - (providerSpent[provider] || 0)),
        };
        return acc;
      }, {}),
      blocked_requests: Number(blockedRows[0]?.count || 0),
    };
    
    return budgetCache;
  } catch (err) {
    console.error("[cost-coordinator] Error refreshing budget cache:", err.message);
    return budgetCache; // Return stale cache on error
  }
}

/**
 * Request budget approval for a model call
 * 
 * @param {Object} request - Budget request
 * @param {string} request.model_id - Model identifier (e.g., "gpt-4o")
 * @param {number} request.estimated_tokens_in - Estimated input tokens
 * @param {number} request.estimated_tokens_out - Estimated output tokens
 * @param {string} request.task_type - Task type for tracking
 * @param {string} request.agent_id - Agent making the request
 * @param {Object} request.alternatives - Alternative models to suggest if rejected
 * 
 * @returns {Object} Approval result
 */
async function requestBudget(request) {
  await refreshBudgetCache();
  
  const {
    model_id,
    estimated_tokens_in = 1000,
    estimated_tokens_out = 500,
    task_type = "unknown",
    agent_id = "unknown",
    alternatives = null,
  } = request;
  
  // Estimate cost
  const costEstimate = estimateCost(model_id, estimated_tokens_in, estimated_tokens_out);
  const estimatedCost = costEstimate.cost_usd;
  const provider = costEstimate.provider;
  
  // Check daily cap
  const dailyRemaining = budgetCache.daily_cap - budgetCache.daily_spent;
  if (estimatedCost > dailyRemaining) {
    await recordBlock({
      model_id,
      provider,
      estimated_cost: estimatedCost,
      reason: "daily_cap_exceeded",
      agent_id,
      task_type,
    });
    
    return {
      approved: false,
      reason: "daily_cap_exceeded",
      message: `Daily budget cap ($${Number(budgetCache.daily_cap || 0).toFixed(2)}) would be exceeded. ` +
               `Spent: $${Number(budgetCache.daily_spent || 0).toFixed(2)}, ` +
               `Requested: $${Number(estimatedCost || 0).toFixed(4)}, ` +
               `Remaining: $${Number(dailyRemaining || 0).toFixed(2)}`,
      alternatives: alternatives || suggestAlternatives(model_id, estimated_tokens_in, estimated_tokens_out),
      budget_state: {
        daily_spent: budgetCache.daily_spent,
        daily_cap: budgetCache.daily_cap,
        daily_remaining: dailyRemaining,
      },
    };
  }
  
  // Check provider-specific cap
  if (provider !== "unknown" && provider !== "ollama") {
    const providerBudget = budgetCache.provider_budgets[provider];
    if (providerBudget && estimatedCost > providerBudget.remaining) {
      await recordBlock({
        model_id,
        provider,
        estimated_cost: estimatedCost,
        reason: "provider_cap_exceeded",
        agent_id,
        task_type,
      });
      
      return {
        approved: false,
        reason: "provider_cap_exceeded",
        message: `${provider} budget cap ($${Number(providerBudget.cap || 0).toFixed(2)}) would be exceeded. ` +
                 `Spent: $${Number(providerBudget.spent || 0).toFixed(2)}, ` +
                 `Requested: $${Number(estimatedCost || 0).toFixed(4)}, ` +
                 `Remaining: $${Number(providerBudget.remaining || 0).toFixed(2)}`,
        alternatives: alternatives || suggestAlternatives(model_id, estimated_tokens_in, estimated_tokens_out),
        budget_state: {
          provider_spent: providerBudget.spent,
          provider_cap: providerBudget.cap,
          provider_remaining: providerBudget.remaining,
        },
      };
  }
  }
  
  // Check if we're getting close to limits (warn but approve)
  const dailyPercentage = (budgetCache.daily_spent / budgetCache.daily_cap) * 100;
  const warning = dailyPercentage >= 80 ? "high" : dailyPercentage >= 60 ? "medium" : null;
  
  // Approve the request
  return {
    approved: true,
    estimated_cost: estimatedCost,
    provider,
    warning,
    message: warning 
      ? `Approved, but daily budget is ${Number(dailyPercentage || 0).toFixed(1)}% used. Monitor spending.`
      : "Approved",
    budget_state: {
      daily_spent: budgetCache.daily_spent,
      daily_cap: budgetCache.daily_cap,
      daily_remaining: dailyRemaining - estimatedCost,
      daily_percentage: dailyPercentage,
    },
  };
}

/**
 * Suggest alternative models if request is rejected
 */
function suggestAlternatives(originalModel, tokensIn, tokensOut) {
  const alternatives = [];
  
  // Map of cheaper alternatives
  const cheaperModels = {
    "gpt-4o": ["gpt-4o-mini", "gemini-2.0-flash", "deepseek-chat"],
    "claude-opus-4-6": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "gemini-2.0-flash"],
    "claude-sonnet-4-6": ["claude-haiku-4-5-20251001", "gemini-2.0-flash", "deepseek-chat"],
    "gemini-2.5-pro": ["gemini-2.0-flash", "deepseek-chat"],
  };
  
  const suggestions = cheaperModels[originalModel] || ["gemini-2.0-flash", "deepseek-chat"];
  
  for (const altModel of suggestions) {
    const altCost = estimateCost(altModel, tokensIn, tokensOut);
    alternatives.push({
      model_id: altModel,
      estimated_cost: altCost.cost_usd,
      provider: altCost.provider,
      savings: estimateCost(originalModel, tokensIn, tokensOut).cost_usd - altCost.cost_usd,
    });
  }
  
  return alternatives;
}

/**
 * Record a blocked request in the database
 */
async function recordBlock(blockData) {
  try {
    await pg.query(
      `INSERT INTO cost_coordinator_blocks
       (model_id, provider, estimated_cost, reason, agent_id, task_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        blockData.model_id,
        blockData.provider,
        blockData.estimated_cost,
        blockData.reason,
        blockData.agent_id,
        blockData.task_type,
      ]
    );
    
    budgetCache.blocked_requests++;
  } catch (err) {
    // Table might not exist yet, log but don't fail
    console.warn("[cost-coordinator] Could not record block:", err.message);
  }
}

/**
 * Get current budget state
 */
async function getBudgetState() {
  await refreshBudgetCache();
  
  return {
    daily_spent: budgetCache.daily_spent,
    daily_cap: budgetCache.daily_cap,
    daily_remaining: budgetCache.daily_cap - budgetCache.daily_spent,
    daily_percentage: (budgetCache.daily_spent / budgetCache.daily_cap) * 100,
    provider_budgets: budgetCache.provider_budgets,
    blocked_requests: budgetCache.blocked_requests,
  };
}

/**
 * Check if system should throttle requests (circuit breaker)
 */
async function shouldThrottle() {
  await refreshBudgetCache();
  
  const dailyPercentage = (budgetCache.daily_spent / budgetCache.daily_cap) * 100;
  
  // Circuit breaker: if we're at 95%+, block all non-critical requests
  if (dailyPercentage >= 95) {
    return {
      throttled: true,
      level: "critical",
      message: "Daily budget at 95%+ - only critical requests allowed",
    };
  }
  
  // Warning: if we're at 80%+, suggest throttling
  if (dailyPercentage >= 80) {
    return {
      throttled: false,
      level: "warning",
      message: "Daily budget at 80%+ - consider throttling non-essential requests",
    };
  }
  
  return {
    throttled: false,
    level: "normal",
    message: "Budget healthy",
  };
}

module.exports = {
  requestBudget,
  getBudgetState,
  shouldThrottle,
  refreshBudgetCache,
  estimateCost,
  suggestAlternatives,
};

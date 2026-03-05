"use strict";

/**
 * mcp-tool-budget.js
 *
 * Lightweight per-run guard to prevent MCP/tool drift.
 * Tracks:
 * - max tool calls
 * - max estimated tokens per tool
 * - max estimated total tokens per run
 */

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function createToolBudget(opts = {}) {
  const maxCalls = Math.max(1, Number(opts.maxCalls || process.env.MCP_TOOL_BUDGET_MAX_CALLS || 30));
  const maxTokensPerTool = Math.max(50, Number(opts.maxTokensPerTool || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_PER_TOOL || 12000));
  const maxTokensTotal = Math.max(200, Number(opts.maxTokensTotal || process.env.MCP_TOOL_BUDGET_MAX_TOKENS_TOTAL || 80000));

  const state = {
    calls: 0,
    totalTokens: 0,
    byTool: {},
    violations: [],
  };

  function record(toolName, payload = "") {
    const name = String(toolName || "unknown_tool").trim() || "unknown_tool";
    const tokens = estimateTokens(payload);

    state.calls += 1;
    state.totalTokens += tokens;
    state.byTool[name] = (state.byTool[name] || 0) + tokens;

    if (state.calls > maxCalls) {
      state.violations.push(`max_calls_exceeded:${state.calls}>${maxCalls}`);
    }
    if ((state.byTool[name] || 0) > maxTokensPerTool) {
      state.violations.push(`max_tokens_per_tool_exceeded:${name}:${state.byTool[name]}>${maxTokensPerTool}`);
    }
    if (state.totalTokens > maxTokensTotal) {
      state.violations.push(`max_tokens_total_exceeded:${state.totalTokens}>${maxTokensTotal}`);
    }

    return {
      allowed: state.violations.length === 0,
      estimated_tokens: tokens,
      calls: state.calls,
      total_tokens: state.totalTokens,
      tool_tokens: state.byTool[name],
      violations: [...state.violations],
    };
  }

  function snapshot() {
    return {
      limits: {
        max_calls: maxCalls,
        max_tokens_per_tool: maxTokensPerTool,
        max_tokens_total: maxTokensTotal,
      },
      usage: {
        calls: state.calls,
        total_tokens: state.totalTokens,
        by_tool: { ...state.byTool },
      },
      violations: [...state.violations],
      ok: state.violations.length === 0,
    };
  }

  return {
    record,
    snapshot,
    estimateTokens,
  };
}

module.exports = {
  createToolBudget,
  estimateTokens,
};

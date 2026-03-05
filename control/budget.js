// control/budget.js
// Daily spend tracking and budget cap enforcement.
// Every LLM call that tracks cost_usd feeds into this.
//
// Set DAILY_COST_CAP_USD in .env (default: $20).
// Set PLAN_COST_CAP_USD in .env (default: $5 per plan).

"use strict";

const redis = require("../infra/redis");

const DAILY_CAP = parseFloat(process.env.DAILY_COST_CAP_USD || "20");
const PLAN_CAP  = parseFloat(process.env.PLAN_COST_CAP_USD  || "5");

function todayKey() {
  return `clawbot:spend:${new Date().toISOString().slice(0, 10)}`;
}

/** Check if a plan's estimated cost would exceed daily/plan caps. Throws if so. */
async function checkBudget(estimatedCostUsd = 0) {
  const spent = await todaySpend();

  if (estimatedCostUsd > PLAN_CAP) {
    throw new Error(
      `Plan cost estimate ($${estimatedCostUsd.toFixed(3)}) exceeds per-plan cap ($${PLAN_CAP}). ` +
      `Raise PLAN_COST_CAP_USD or break the goal into smaller steps.`
    );
  }

  if (spent + estimatedCostUsd > DAILY_CAP) {
    throw new Error(
      `Daily spend cap ($${DAILY_CAP}) would be exceeded. ` +
      `Spent today: $${spent.toFixed(3)}. Estimated: $${estimatedCostUsd.toFixed(3)}. ` +
      `Raise DAILY_COST_CAP_USD or wait until tomorrow.`
    );
  }
}

/** Record actual spend after a task completes. */
async function trackSpend(costUsd) {
  if (!costUsd || costUsd <= 0) return;
  const key = todayKey();
  await redis.incrbyfloat(key, costUsd);
  await redis.expire(key, 86400 * 2); // keep for 2 days
}

/** Returns total spend for today in USD. */
async function todaySpend() {
  return parseFloat((await redis.get(todayKey())) || "0");
}

/** Returns spend summary for display. */
async function spendSummary() {
  const spent = await todaySpend();
  const remaining = Math.max(0, DAILY_CAP - spent);
  return { spent_usd: spent, daily_cap_usd: DAILY_CAP, remaining_usd: remaining };
}

module.exports = { checkBudget, trackSpend, todaySpend, spendSummary, DAILY_CAP, PLAN_CAP };

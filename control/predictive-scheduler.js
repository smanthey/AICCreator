"use strict";

/**
 * control/predictive-scheduler.js
 * 
 * Predictive scheduling using Golden Window algorithm.
 * Predicts optimal execution times based on historical performance.
 */

const fsp = require("fs/promises");
const path = require("path");
const { atomicAppendJSONL, atomicReadModifyWrite } = require("./atomic-state");

const ROOT = path.join(__dirname, "..");
const PERFORMANCE_LOG = path.join(ROOT, "agent-state", "performance.ndjson");
const SCHEDULE_WEIGHTS = path.join(ROOT, "agent-state", "schedule-weights.json");

// Constants for Golden Window algorithm
const WEIGHT_SUCCESS = 0.7; // Weight for historical success rate
const WEIGHT_RESOURCE = 0.3; // Weight for resource utilization
const BUCKET_SIZE_MINUTES = 15; // 15-minute time buckets
const BUCKETS_PER_DAY = (24 * 60) / BUCKET_SIZE_MINUTES; // 96 buckets
const READINESS_THRESHOLD = 0.8; // Minimum score to trigger execution

// ─── Log Performance Metric ───────────────────────────────────────────────────

/**
 * Log a performance metric for an agent run
 * Lightweight append to JSONL file
 */
async function logPerformanceMetric({
  agent_id,
  timestamp = new Date().toISOString(),
  cpu_usage = null,
  memory_usage = null,
  execution_time_ms = null,
  outcome = "unknown", // "success", "fail", "timeout"
  resource_utilization = null,
}) {
  const metric = {
    timestamp,
    agent_id,
    cpu_usage,
    memory_usage,
    execution_time_ms,
    outcome,
    resource_utilization,
  };
  
  // Atomic append to JSONL
  await atomicAppendJSONL(PERFORMANCE_LOG, metric);
}

// ─── Calculate Time Bucket ────────────────────────────────────────────────────

function getTimeBucket(timestamp = new Date()) {
  const date = new Date(timestamp);
  const minutesSinceMidnight = date.getHours() * 60 + date.getMinutes();
  return Math.floor(minutesSinceMidnight / BUCKET_SIZE_MINUTES);
}

// ─── Load Performance Data ─────────────────────────────────────────────────────

async function loadPerformanceData(days = 30) {
  try {
    const content = await fsp.readFile(PERFORMANCE_LOG, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    const metrics = lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(m => m && new Date(m.timestamp).getTime() > cutoff);
    
    return metrics;
  } catch {
    return [];
  }
}

// ─── Calculate Readiness Score ────────────────────────────────────────────────

/**
 * Calculate readiness score for a time bucket
 * S = (W_s * P_success) - (W_r * R_utilization)
 */
function calculateReadinessScore(bucketMetrics) {
  if (bucketMetrics.length === 0) {
    return 0.5; // Default score if no data
  }
  
  // Calculate success probability
  const successes = bucketMetrics.filter(m => m.outcome === "success").length;
  const pSuccess = successes / bucketMetrics.length;
  
  // Calculate average resource utilization
  const resourceValues = bucketMetrics
    .map(m => m.resource_utilization || m.cpu_usage || 0)
    .filter(v => v !== null);
  const rUtilization = resourceValues.length > 0
    ? resourceValues.reduce((a, b) => a + b, 0) / resourceValues.length
    : 0.5; // Default to 50% if unknown
  
  // Normalize resource utilization (0-1 scale)
  const normalizedUtilization = Math.min(1, rUtilization / 100);
  
  // Calculate score
  const score = (WEIGHT_SUCCESS * pSuccess) - (WEIGHT_RESOURCE * normalizedUtilization);
  
  return Math.max(0, Math.min(1, score)); // Clamp to 0-1
}

// ─── Generate Schedule Weights ───────────────────────────────────────────────

async function generateScheduleWeights(agentId = null) {
  const metrics = await loadPerformanceData(30);
  
  // Filter by agent if specified
  const agentMetrics = agentId
    ? metrics.filter(m => m.agent_id === agentId)
    : metrics;
  
  // Group by time bucket
  const bucketData = {};
  for (const metric of agentMetrics) {
    const bucket = getTimeBucket(metric.timestamp);
    if (!bucketData[bucket]) {
      bucketData[bucket] = [];
    }
    bucketData[bucket].push(metric);
  }
  
  // Calculate scores for each bucket
  const weights = {};
  for (let bucket = 0; bucket < BUCKETS_PER_DAY; bucket++) {
    const bucketMetrics = bucketData[bucket] || [];
    weights[bucket] = {
      score: calculateReadinessScore(bucketMetrics),
      sample_size: bucketMetrics.length,
      success_rate: bucketMetrics.length > 0
        ? bucketMetrics.filter(m => m.outcome === "success").length / bucketMetrics.length
        : null,
      avg_resource_utilization: bucketMetrics.length > 0
        ? bucketMetrics.reduce((sum, m) => sum + (m.resource_utilization || m.cpu_usage || 0), 0) / bucketMetrics.length
        : null,
    };
  }
  
  return weights;
}

// ─── Get Golden Window ────────────────────────────────────────────────────────

/**
 * Get the next "Golden Window" (best time to run) for an agent
 * Returns the bucket with highest readiness score in the next 4 buckets
 */
async function getGoldenWindow(agentId, lookaheadBuckets = 4) {
  const weights = await generateScheduleWeights(agentId);
  const currentBucket = getTimeBucket();
  
  // Look at next N buckets
  const candidates = [];
  for (let i = 0; i < lookaheadBuckets; i++) {
    const bucket = (currentBucket + i) % BUCKETS_PER_DAY;
    candidates.push({
      bucket,
      score: weights[bucket]?.score || 0.5,
      sample_size: weights[bucket]?.sample_size || 0,
    });
  }
  
  // Sort by score (descending)
  candidates.sort((a, b) => b.score - a.score);
  
  const best = candidates[0];
  const current = candidates.find(c => c.bucket === currentBucket);
  
  return {
    current_bucket: currentBucket,
    current_score: current?.score || 0.5,
    best_bucket: best.bucket,
    best_score: best.score,
    should_run_now: (current?.score || 0.5) >= READINESS_THRESHOLD,
    should_defer: best.bucket !== currentBucket && best.score > (current?.score || 0.5) + 0.1,
    defer_to_bucket: best.bucket !== currentBucket ? best.bucket : null,
    buckets: candidates,
  };
}

// ─── Update Schedule Weights ─────────────────────────────────────────────────

async function updateScheduleWeights() {
  const weights = await generateScheduleWeights();
  
  await atomicReadModifyWrite(SCHEDULE_WEIGHTS, async (current) => {
    return {
      ...current,
      last_updated: new Date().toISOString(),
      weights,
      metadata: {
        bucket_size_minutes: BUCKET_SIZE_MINUTES,
        buckets_per_day: BUCKETS_PER_DAY,
        weight_success: WEIGHT_SUCCESS,
        weight_resource: WEIGHT_RESOURCE,
        readiness_threshold: READINESS_THRESHOLD,
      },
    };
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  logPerformanceMetric,
  getTimeBucket,
  generateScheduleWeights,
  getGoldenWindow,
  updateScheduleWeights,
  loadPerformanceData,
  BUCKET_SIZE_MINUTES,
  BUCKETS_PER_DAY,
  READINESS_THRESHOLD,
};

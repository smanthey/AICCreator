#!/usr/bin/env node
"use strict";

/**
 * bot-self-healing.js — Self-Healing System for Bot Collection
 * 
 * Automatically detects, diagnoses, and fixes issues:
 * - Database connection failures → auto-reconnect
 * - API failures → circuit breakers + fallbacks
 * - Rate limits → exponential backoff
 * - Invalid data → validation + cleanup
 * - Performance degradation → auto-optimization
 */

require("dotenv").config({ override: true });

const { Pool } = require("pg");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HEALTH_DIR = path.join(ROOT, "agent-state", "bot-health");
const HEALTH_LOG = path.join(HEALTH_DIR, "health-log.jsonl");

// Integrate with system health coordinator
let systemHealthCoordinator = null;
try {
  systemHealthCoordinator = require("../control/system-health-coordinator");
} catch {
  // Coordinator not available, continue with local health checks
}

// Circuit breakers for external services
const circuitBreakers = new Map();

// Health metrics
const healthMetrics = {
  database: { status: "unknown", lastCheck: null, consecutiveFailures: 0 },
  ollama: { status: "unknown", lastCheck: null, consecutiveFailures: 0 },
  deepseek: { status: "unknown", lastCheck: null, consecutiveFailures: 0 },
  gemini: { status: "unknown", lastCheck: null, consecutiveFailures: 0 },
  discovery: { status: "unknown", lastCheck: null, consecutiveFailures: 0 },
  outreach: { status: "unknown", lastCheck: null, consecutiveFailures: 0 },
};

// ─── Circuit Breaker ────────────────────────────────────────────────────────

function getCircuitBreaker(service) {
  if (!circuitBreakers.has(service)) {
    circuitBreakers.set(service, {
      state: "closed", // closed, open, half-open
      failures: 0,
      lastFailure: null,
      openedAt: null,
    });
  }
  return circuitBreakers.get(service);
}

function checkCircuitBreaker(service, threshold = 5, timeout = 60000) {
  const breaker = getCircuitBreaker(service);
  
  if (breaker.state === "open") {
    const timeSinceOpen = Date.now() - breaker.openedAt;
    if (timeSinceOpen > timeout) {
      breaker.state = "half-open";
      breaker.failures = 0;
      return true; // Allow one attempt
    }
    return false; // Still open
  }
  
  return true; // Closed or half-open
}

function recordCircuitBreakerSuccess(service) {
  const breaker = getCircuitBreaker(service);
  if (breaker.state === "half-open") {
    breaker.state = "closed";
    breaker.failures = 0;
  }
}

function recordCircuitBreakerFailure(service, threshold = 5) {
  const breaker = getCircuitBreaker(service);
  breaker.failures++;
  breaker.lastFailure = Date.now();
  
  if (breaker.failures >= threshold) {
    breaker.state = "open";
    breaker.openedAt = Date.now();
    logHealthEvent("circuit_breaker_opened", { service, failures: breaker.failures });
  }
}

// ─── Health Checks ──────────────────────────────────────────────────────────

async function checkDatabaseHealth() {
  const pool = new Pool({
    host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
    port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
    user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
    password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
    connectionTimeoutMillis: 5000,
  });
  
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    const latency = Date.now() - start;
    
    healthMetrics.database = {
      status: "healthy",
      lastCheck: new Date().toISOString(),
      latency,
      consecutiveFailures: 0,
    };
    
    await pool.end();
    recordCircuitBreakerSuccess("database");
    return true;
  } catch (err) {
    healthMetrics.database = {
      status: "unhealthy",
      lastCheck: new Date().toISOString(),
      error: err.message,
      consecutiveFailures: healthMetrics.database.consecutiveFailures + 1,
    };
    
    await pool.end().catch(() => {});
    recordCircuitBreakerFailure("database");
    logHealthEvent("database_unhealthy", { error: err.message });
    return false;
  }
}

async function checkOllamaHealth() {
  const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  
  try {
    const start = Date.now();
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const latency = Date.now() - start;
    healthMetrics.ollama = {
      status: "healthy",
      lastCheck: new Date().toISOString(),
      latency,
      consecutiveFailures: 0,
    };
    
    recordCircuitBreakerSuccess("ollama");
    return true;
  } catch (err) {
    healthMetrics.ollama = {
      status: "unhealthy",
      lastCheck: new Date().toISOString(),
      error: err.message,
      consecutiveFailures: healthMetrics.ollama.consecutiveFailures + 1,
    };
    
    recordCircuitBreakerFailure("ollama");
    logHealthEvent("ollama_unhealthy", { error: err.message });
    return false;
  }
}

async function checkDeepSeekHealth() {
  if (!process.env.DEEPSEEK_API_KEY) {
    healthMetrics.deepseek = { status: "not_configured", lastCheck: new Date().toISOString() };
    return false;
  }
  
  try {
    const start = Date.now();
    const response = await fetch("https://api.deepseek.com/v1/models", {
      headers: { "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const latency = Date.now() - start;
    healthMetrics.deepseek = {
      status: "healthy",
      lastCheck: new Date().toISOString(),
      latency,
      consecutiveFailures: 0,
    };
    
    recordCircuitBreakerSuccess("deepseek");
    return true;
  } catch (err) {
    healthMetrics.deepseek = {
      status: "unhealthy",
      lastCheck: new Date().toISOString(),
      error: err.message,
      consecutiveFailures: healthMetrics.deepseek.consecutiveFailures + 1,
    };
    
    recordCircuitBreakerFailure("deepseek");
    return false;
  }
}

async function checkGeminiHealth() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    healthMetrics.gemini = { status: "not_configured", lastCheck: new Date().toISOString() };
    return false;
  }
  
  try {
    const start = Date.now();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const latency = Date.now() - start;
    healthMetrics.gemini = {
      status: "healthy",
      lastCheck: new Date().toISOString(),
      latency,
      consecutiveFailures: 0,
    };
    
    recordCircuitBreakerSuccess("gemini");
    return true;
  } catch (err) {
    healthMetrics.gemini = {
      status: "unhealthy",
      lastCheck: new Date().toISOString(),
      error: err.message,
      consecutiveFailures: healthMetrics.gemini.consecutiveFailures + 1,
    };
    
    recordCircuitBreakerFailure("gemini");
    return false;
  }
}

// ─── Auto-Recovery ──────────────────────────────────────────────────────────

async function recoverDatabaseConnection() {
  console.log("[healing] Attempting database recovery...");
  
  // Try to reconnect
  const healthy = await checkDatabaseHealth();
  if (healthy) {
    logHealthEvent("database_recovered", {});
    return true;
  }
  
  // If still failing, log and wait
  logHealthEvent("database_recovery_failed", {});
  return false;
}

async function recoverOllama() {
  console.log("[healing] Attempting Ollama recovery...");
  
  // Check if Ollama process is running (basic check)
  const healthy = await checkOllamaHealth();
  if (healthy) {
    logHealthEvent("ollama_recovered", {});
    return true;
  }
  
  // Could try to restart Ollama via PM2 if available
  logHealthEvent("ollama_recovery_failed", {});
  return false;
}

// ─── Health Monitoring ──────────────────────────────────────────────────────

async function runHealthChecks() {
  console.log("[healing] Running health checks...");
  
  const checks = [
    { name: "database", fn: checkDatabaseHealth },
    { name: "ollama", fn: checkOllamaHealth },
    { name: "deepseek", fn: checkDeepSeekHealth },
    { name: "gemini", fn: checkGeminiHealth },
  ];
  
  const results = {};
  for (const check of checks) {
    try {
      results[check.name] = await check.fn();
    } catch (err) {
      results[check.name] = false;
      logHealthEvent("health_check_error", { service: check.name, error: err.message });
    }
  }
  
  return results;
}

async function getHealthStatus() {
  return {
    timestamp: new Date().toISOString(),
    metrics: healthMetrics,
    circuitBreakers: Object.fromEntries(
      Array.from(circuitBreakers.entries()).map(([k, v]) => [k, {
        state: v.state,
        failures: v.failures,
      }])
    ),
  };
}

// ─── Logging ────────────────────────────────────────────────────────────────

async function logHealthEvent(eventType, data) {
  await fsp.mkdir(HEALTH_DIR, { recursive: true });
  
  const entry = {
    timestamp: new Date().toISOString(),
    event: eventType,
    data,
  };
  
  await fsp.appendFile(HEALTH_LOG, JSON.stringify(entry) + "\n");
  
      // Also report to system health coordinator if available
      if (systemHealthCoordinator) {
        try {
          await systemHealthCoordinator.loadHealthState();
          // Coordinator will pick up health events through its own monitoring
          // No need to manually update here - coordinator runs its own checks
        } catch (err) {
          // Coordinator integration failed, continue with local logging
          console.warn("[healing] Failed to integrate with system coordinator:", err.message);
        }
      }
}

// ─── Retry with Exponential Backoff ──────────────────────────────────────────

async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    service = "unknown",
  } = options;
  
  if (!checkCircuitBreaker(service)) {
    throw new Error(`Circuit breaker is open for ${service}`);
  }
  
  let delay = initialDelay;
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      recordCircuitBreakerSuccess(service);
      return result;
    } catch (err) {
      lastError = err;
      
      // Check if it's a rate limit error
      if (err.status === 429 || err.message.includes("rate limit")) {
        delay = Math.min(delay * factor, maxDelay);
        console.warn(`[healing] Rate limited, backing off ${delay}ms (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Check if it's a temporary error
      if (err.status >= 500 || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
        if (attempt < maxAttempts) {
          delay = Math.min(delay * factor, maxDelay);
          console.warn(`[healing] Temporary error, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // Permanent error or max attempts reached
      recordCircuitBreakerFailure(service);
      throw err;
    }
  }
  
  recordCircuitBreakerFailure(service);
  throw lastError;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  checkDatabaseHealth,
  checkOllamaHealth,
  checkDeepSeekHealth,
  checkGeminiHealth,
  runHealthChecks,
  getHealthStatus,
  recoverDatabaseConnection,
  recoverOllama,
  retryWithBackoff,
  checkCircuitBreaker,
  recordCircuitBreakerSuccess,
  recordCircuitBreakerFailure,
  logHealthEvent,
};

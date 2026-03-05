"use strict";

/**
 * control/heartbeat-validator.js
 * 
 * Heartbeat Validation for Self-Healing
 * 
 * Problem: Self-healing scripts wait for specific error codes that never trigger.
 * Example: Healer looks for ECONNREFUSED from Ollama, but Ollama is just hanging
 * (infinite loop) without crashing. The healer sits "active" but doing nothing.
 * 
 * Solution: Instead of waiting for errors, actively "ping" services with tiny tasks.
 * If no response in 10 seconds, heal—regardless of whether an error was thrown.
 */

const { chat } = require("../infra/model-router");
const pg = require("../infra/postgres");
const redis = require("../infra/redis");

// Service definitions with their ping methods
const SERVICE_PINGS = {
  ollama: {
    name: "Ollama",
    timeout: 10000, // 10 seconds
    ping: async () => {
      try {
        const response = await fetch("http://127.0.0.1:11434/api/tags", {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          return { ok: false, reason: `HTTP ${response.status}` };
        }
        const data = await response.json().catch(() => null);
        return { ok: true, data: data?.models?.length || 0 };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
    // Also test with a tiny model call
    pingWithTask: async () => {
      try {
        const result = await chat("echo", "", "Say 'pong'", {
          max_tokens: 10,
          timeout_ms: 10000,
        });
        return { ok: true, response: result.text?.slice(0, 20) };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
  },
  
  database: {
    name: "PostgreSQL",
    timeout: 5000,
    ping: async () => {
      try {
        const start = Date.now();
        await pg.query("SELECT 1");
        const latency = Date.now() - start;
        return { ok: true, latency_ms: latency };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
  },
  
  redis: {
    name: "Redis",
    timeout: 5000,
    ping: async () => {
      try {
        const client = redis.getClient ? redis.getClient() : redis;
        const start = Date.now();
        const result = await client.ping();
        const latency = Date.now() - start;
        return { ok: result === "PONG", latency_ms: latency };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
  },
};

/**
 * Validate a service with heartbeat ping
 * Returns true if service is healthy, false if it needs healing
 */
async function validateService(serviceId) {
  const service = SERVICE_PINGS[serviceId];
  if (!service) {
    throw new Error(`Unknown service: ${serviceId}`);
  }
  
  console.log(`[heartbeat-validator] Pinging ${service.name}...`);
  
  // First, try basic ping
  const basicPing = await service.ping();
  
  if (!basicPing.ok) {
    console.warn(`[heartbeat-validator] ${service.name} basic ping failed: ${basicPing.reason}`);
    return {
      healthy: false,
      reason: `Basic ping failed: ${basicPing.reason}`,
      service: serviceId,
      service_name: service.name,
    };
  }
  
  // For Ollama, also test with a tiny task
  if (serviceId === "ollama" && service.pingWithTask) {
    const taskPing = await service.pingWithTask();
    if (!taskPing.ok) {
      console.warn(`[heartbeat-validator] ${service.name} task ping failed: ${taskPing.reason}`);
      return {
        healthy: false,
        reason: `Task ping failed: ${taskPing.reason}`,
        service: serviceId,
        service_name: service.name,
        basic_ping_ok: true, // Basic ping worked, but task failed
      };
    }
    
    return {
      healthy: true,
      service: serviceId,
      service_name: service.name,
      basic_ping: basicPing,
      task_ping: taskPing,
    };
  }
  
  return {
    healthy: true,
    service: serviceId,
    service_name: service.name,
    ping: basicPing,
  };
}

/**
 * Validate all critical services
 */
async function validateAllServices() {
  const results = {};
  
  for (const serviceId of Object.keys(SERVICE_PINGS)) {
    try {
      results[serviceId] = await validateService(serviceId);
    } catch (err) {
      results[serviceId] = {
        healthy: false,
        error: err.message,
        service: serviceId,
      };
    }
  }
  
  return results;
}

/**
 * Check if a service needs healing (not just unhealthy, but actively broken)
 */
function needsHealing(validationResult) {
  if (!validationResult) return false;
  if (validationResult.healthy) return false;
  
  // If basic ping failed, definitely needs healing
  if (!validationResult.basic_ping_ok && validationResult.basic_ping_ok !== undefined) {
    return true;
  }
  
  // If task ping failed but basic ping worked, might be degraded but not broken
  // Still flag it for healing
  return true;
}

module.exports = {
  validateService,
  validateAllServices,
  needsHealing,
  SERVICE_PINGS,
};

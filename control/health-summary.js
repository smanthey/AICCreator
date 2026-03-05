"use strict";

/**
 * @typedef {object} HealthServiceSummary
 * @property {string} name
 * @property {string} status
 * @property {boolean} healthy
 * @property {number|null} latency_ms
 * @property {number} consecutive_failures
 * @property {string|null} error
 */

/**
 * @typedef {object} AuthProviderSummary
 * @property {string} name
 * @property {boolean} ok
 * @property {string|null} reason
 */

/**
 * @typedef {object} HealthSummary
 * @property {string} schema_version
 * @property {string} checked_at
 * @property {string} overall_status
 * @property {boolean} safe_mode
 * @property {{healthy:number,degraded:number,down:number,unknown:number}} totals
 * @property {HealthServiceSummary[]} services
 * @property {AuthProviderSummary[]} auth_providers
 * @property {{healthy:boolean,last_update:string|null,age_minutes:number|null,stale:boolean}|null} coordinator
 */

function serviceStatus(raw) {
  const status = String(raw?.status || "unknown").toLowerCase();
  if (status === "healthy") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "unhealthy" || status === "down") return "down";
  return "unknown";
}

function normalizeServices(services = {}) {
  return Object.entries(services || {}).map(([name, raw]) => ({
    name,
    status: serviceStatus(raw),
    healthy: serviceStatus(raw) === "healthy",
    latency_ms: Number.isFinite(Number(raw?.latency_ms)) ? Number(raw.latency_ms) : null,
    consecutive_failures: Number(raw?.consecutive_failures || 0),
    error: raw?.error ? String(raw.error) : null,
  }));
}

function buildHealthSummary(options = {}) {
  const services = normalizeServices(options.services || {});
  const authProviders = Array.isArray(options.authProviders) ? options.authProviders : [];
  const totals = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
  for (const s of services) {
    if (s.status === "healthy") totals.healthy += 1;
    else if (s.status === "degraded") totals.degraded += 1;
    else if (s.status === "down") totals.down += 1;
    else totals.unknown += 1;
  }
  const overallStatus = totals.down > 0 ? "down" : (totals.degraded > 0 ? "degraded" : "healthy");

  return {
    schema_version: "2026-03-03.health.v1",
    checked_at: options.checkedAt || new Date().toISOString(),
    overall_status: overallStatus,
    safe_mode: Boolean(options.safeMode),
    totals,
    services,
    auth_providers: authProviders.map((p) => ({
      name: String(p?.name || "unknown"),
      ok: Boolean(p?.ok),
      reason: p?.reason ? String(p.reason) : null,
    })),
    coordinator: options.coordinator || null,
  };
}

function authProvidersFromEnv() {
  return [
    {
      name: "openai",
      ok: Boolean(process.env.OPENAI_API_KEY),
      reason: process.env.OPENAI_API_KEY ? "configured" : "missing OPENAI_API_KEY",
    },
    {
      name: "anthropic",
      ok: Boolean(process.env.ANTHROPIC_API_KEY),
      reason: process.env.ANTHROPIC_API_KEY ? "configured" : "missing ANTHROPIC_API_KEY",
    },
    {
      name: "ollama",
      ok: Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"),
      reason: "host configured",
    },
  ];
}

module.exports = {
  buildHealthSummary,
  authProvidersFromEnv,
};

"use strict";

// Deterministic policy gate. AI may suggest actions, but execution is blocked
// unless policy allows it.
const { evaluateOpaPolicy } = require("./opa-client");

const MUTATING_TYPES = new Set([
  "migrate",
  "patch",
  "send_email",
  "github_sync",
  "github_add_repo",
  "fetch_leads",
]);

const BATCH_LIMITS = {
  media_enrich: parseInt(process.env.POLICY_MAX_MEDIA_ENRICH_LIMIT || "2000", 10),
  media_hash:   parseInt(process.env.POLICY_MAX_MEDIA_HASH_LIMIT || "5000", 10),
  media_visual_catalog: parseInt(process.env.POLICY_MAX_MEDIA_VISUAL_LIMIT || "5000", 10),
};

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function startsWithAny(input, prefixes) {
  return prefixes.some(p => input.startsWith(p));
}

function disallowedPath(pathValue) {
  const p = String(pathValue || "");
  const blocked = [
    "/System",
    "/Library",
    "/bin",
    "/sbin",
    "/usr",
    "/etc",
    "/private/etc",
    "/Applications",
  ];
  return blocked.find(prefix => p.startsWith(prefix)) || null;
}

function getAllowedPrefixes() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/Users/tatsheen";
  const raw = process.env.POLICY_ALLOWED_PATH_PREFIXES
    || `${homeDir}/claw-architect,${homeDir}/claw,/tmp`;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function evaluateTaskPolicy(task) {
  const type = String(task?.type || "");
  const payload = task?.payload || {};

  const blockedTypes = (process.env.POLICY_BLOCKED_TASK_TYPES || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (blockedTypes.includes(type)) {
    return { allowed: false, reason: `task type "${type}" is blocked by policy` };
  }

  const readOnly = envBool("POLICY_READ_ONLY_MODE", false);
  if (readOnly && MUTATING_TYPES.has(type)) {
    return { allowed: false, reason: `read-only mode blocks mutating task type "${type}"` };
  }

  if (type in BATCH_LIMITS && payload.limit != null) {
    const max = BATCH_LIMITS[type];
    const n = Number(payload.limit);
    if (!Number.isFinite(n) || n < 1 || n > max) {
      return { allowed: false, reason: `${type}.limit=${payload.limit} exceeds policy max ${max}` };
    }
  }

  const pathFields = ["path", "source_path", "dest_path"];
  const allowedPrefixes = getAllowedPrefixes();
  for (const field of pathFields) {
    if (!payload[field]) continue;
    const val = String(payload[field]);
    const blockedPrefix = disallowedPath(val);
    if (blockedPrefix) {
      return { allowed: false, reason: `payload.${field} points to blocked prefix ${blockedPrefix}` };
    }
    if (!startsWithAny(val, allowedPrefixes)) {
      return { allowed: false, reason: `payload.${field} is outside allowed prefixes` };
    }
  }

  if (envBool("POLICY_DISABLE_DESTRUCTIVE_FLAGS", true)) {
    if (payload.delete === true || payload.overwrite_all === true || payload.force_delete === true) {
      return { allowed: false, reason: "destructive payload flags are disabled by policy" };
    }
  }

  return { allowed: true, reason: "allowed" };
}

function buildPolicyInput(task) {
  const type = String(task?.type || "");
  const payload = task?.payload || {};
  const readOnly = envBool("POLICY_READ_ONLY_MODE", false);
  const mutating = MUTATING_TYPES.has(type);
  const blockedTypes = (process.env.POLICY_BLOCKED_TASK_TYPES || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return {
    id: task?.id || null,
    type,
    plan_id: task?.plan_id || null,
    payload,
    context: {
      read_only_mode: readOnly,
      mutating_task: mutating,
      blocked_types: blockedTypes,
      policy_allowed_path_prefixes: getAllowedPrefixes(),
      policy_disable_destructive_flags: envBool("POLICY_DISABLE_DESTRUCTIVE_FLAGS", true),
    },
  };
}

async function evaluateTaskPolicyWithExternal(task) {
  const local = evaluateTaskPolicy(task);

  const useOpa = envBool("POLICY_USE_OPA", false);
  if (!useOpa) return { ...local, engine: "local" };

  const input = buildPolicyInput(task);
  const type = String(task?.type || "");
  const mutating = MUTATING_TYPES.has(type);
  const failClosedMutating = envBool("POLICY_OPA_FAIL_CLOSED_MUTATING", true);

  try {
    const opa = await evaluateOpaPolicy(input);
    if (!opa.ok) {
      if (mutating && failClosedMutating) {
        return { allowed: false, reason: `opa_unavailable_fail_closed:${opa.reason}`, engine: "opa+local", local_reason: local.reason };
      }
      // Fallback to local deterministic policy when OPA unavailable for non-mutating tasks.
      return { ...local, engine: "local_fallback", opa_error: opa.reason };
    }
    if (!opa.allowed) {
      return { allowed: false, reason: `opa_denied:${opa.reason}`, engine: "opa", deny: opa.deny || [] };
    }
    if (!local.allowed) {
      return { ...local, engine: "opa+local" };
    }
    return { allowed: true, reason: "allowed", engine: "opa+local" };
  } catch (err) {
    if (mutating && failClosedMutating) {
      return { allowed: false, reason: `opa_exception_fail_closed:${err.message}`, engine: "opa+local", local_reason: local.reason };
    }
    return { ...local, engine: "local_fallback", opa_error: err.message };
  }
}

module.exports = {
  evaluateTaskPolicy,
  evaluateTaskPolicyWithExternal,
  MUTATING_TYPES,
};

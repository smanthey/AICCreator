"use strict";

const crypto = require("crypto");

const EPHEMERAL_KEYS = new Set([
  "task_id",
  "plan_id",
  "timeout_s",
  "retry_count",
  "created_at",
  "updated_at",
]);

function stripEphemeral(value) {
  if (Array.isArray(value)) {
    return value.map(stripEphemeral);
  }
  if (!value || typeof value !== "object") return value;

  const out = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    if (EPHEMERAL_KEYS.has(key)) continue;
    const v = value[key];
    if (v === undefined) continue;
    out[key] = stripEphemeral(v);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(stripEphemeral(value));
}

function digest(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function canonicalPayloadFor(type, payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  const workflowRunId = payload.workflow_run_id ? String(payload.workflow_run_id) : null;

  if (type === "media_enrich") {
    return {
      workflow_run_id: workflowRunId,
      hostname: payload.hostname || null,
      limit: Number(payload.limit) || 100,
      force: payload.force === true,
      dry_run: payload.dry_run === true,
    };
  }

  if (type === "media_hash") {
    return {
      workflow_run_id: workflowRunId,
      hostname: payload.hostname || null,
      limit: Number(payload.limit) || 200,
      force: payload.force === true,
      dry_run: payload.dry_run === true,
      frame_second: Number(payload.frame_second) || 1,
    };
  }

  if (type === "media_visual_catalog") {
    return {
      workflow_run_id: workflowRunId,
      hostname: payload.hostname || null,
      limit: Number(payload.limit) || 150,
      force: payload.force === true,
      dry_run: payload.dry_run === true,
      use_openai_vision: payload.use_openai_vision === true,
    };
  }

  if (type === "cluster_media") {
    return {
      workflow_run_id: workflowRunId,
      hostname: payload.hostname || null,
      limit: Number(payload.limit) || 5000,
      force: payload.force === true,
      dry_run: payload.dry_run === true,
      time_window_minutes: Number(payload.time_window_minutes) || 90,
      hash_hamming_threshold: Number(payload.hash_hamming_threshold) || 12,
      gps_delta: Number(payload.gps_delta) || 0.02,
    };
  }

  if (type === "classify") {
    const files = Array.isArray(payload.files)
      ? [...payload.files].map((f) => String(f)).sort()
      : null;
    return {
      workflow_run_id: workflowRunId,
      path: payload.path || null,
      force: payload.force === true,
      limit: Number(payload.limit) || null,
      low_confidence_threshold:
        payload.low_confidence_threshold == null
          ? null
          : Number(payload.low_confidence_threshold),
      files,
    };
  }

  return {
    workflow_run_id: workflowRunId,
    ...stripEphemeral(payload),
  };
}

function buildTaskIdempotencyKey(type, payload = {}) {
  if (payload && typeof payload.idempotency_key === "string" && payload.idempotency_key.trim()) {
    return payload.idempotency_key.trim();
  }
  const canonical = canonicalPayloadFor(type, payload);
  return `${type}:${digest(stableStringify(canonical))}`;
}

module.exports = {
  buildTaskIdempotencyKey,
  canonicalPayloadFor,
};

"use strict";

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function parseMaybeJson(text) {
  if (typeof text !== "string") return null;
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function hasRequiredFields(obj, requiredFields) {
  if (!obj || typeof obj !== "object") return false;
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) return true;
  return requiredFields.every((key) => {
    const value = obj[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function contradictionChecksPass(text, obj) {
  if (typeof text !== "string") return false;
  const low = text.toLowerCase();
  const contradictionTerms = [
    "i cannot",
    "i can't",
    "cannot comply",
    "not enough information",
    "insufficient context",
    "unable to determine",
  ];
  if (contradictionTerms.some((t) => low.includes(t))) return false;

  if (obj && typeof obj === "object") {
    if (typeof obj.error === "string" && obj.error.trim()) return false;
    if (typeof obj.status === "string" && ["error", "failed"].includes(obj.status.toLowerCase())) return false;
  }
  return true;
}

function citationsPresent(text, obj, options = {}) {
  if (options.requireCitations !== true) return true;
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj.sources) && obj.sources.length > 0) return true;
    if (Array.isArray(obj.citations) && obj.citations.length > 0) return true;
    if (typeof obj.evidence === "string" && obj.evidence.trim()) return true;
  }
  if (typeof text === "string") {
    if (/https?:\/\//i.test(text)) return true;
    if (/\bsource\b/i.test(text)) return true;
  }
  return false;
}

function normalizeConfidence(taskType, rawResponse = {}, options = {}) {
  const explicit = rawResponse.confidence ?? rawResponse?.json?.confidence ?? null;
  if (explicit !== null && explicit !== undefined) {
    return {
      confidence: clamp01(explicit),
      rubric: {
        explicit: true,
        schema_valid: null,
        required_fields: null,
        contradiction_checks: null,
        citations: null,
      },
    };
  }

  const text = typeof rawResponse.text === "string" ? rawResponse.text : "";
  const obj = rawResponse.json || parseMaybeJson(text);

  const schemaValid = !!obj;
  const requiredFieldsOk = hasRequiredFields(obj, options.requiredFields || []);
  const contradictionOk = contradictionChecksPass(text, obj);
  const citationsOk = citationsPresent(text, obj, options);

  const score =
    (schemaValid ? 0.35 : 0) +
    (requiredFieldsOk ? 0.25 : 0) +
    (contradictionOk ? 0.2 : 0) +
    (citationsOk ? 0.2 : 0);

  return {
    confidence: clamp01(score),
    rubric: {
      explicit: false,
      schema_valid: schemaValid,
      required_fields: requiredFieldsOk,
      contradiction_checks: contradictionOk,
      citations: citationsOk,
      task_type: taskType,
    },
  };
}

module.exports = {
  normalizeConfidence,
  parseMaybeJson,
};

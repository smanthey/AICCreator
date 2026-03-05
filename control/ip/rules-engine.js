"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pg = require("../../infra/postgres");
const { deepClone, deepMerge, normalizeExaminerName } = require("./rule-patch");

const DEFAULT_RULES_PATH = process.env.IP_RULES_PATH || path.join(process.cwd(), "config", "ip-rules", "ip-rules.v1.json");
const OVERLAYS_DIR = process.env.IP_RULES_OVERLAYS_DIR || path.join(process.cwd(), "config", "ip-rules", "overrides");

let _cache = null;

function hashText(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function loadRulesSync(filePath = DEFAULT_RULES_PATH) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const checksum = hashText(raw);
  return { rules: parsed, checksum, filePath };
}

async function ensureRuleSetRegistered() {
  const { rules, checksum, filePath } = loadRulesSync();
  const version = Number(rules?.meta?.version || 1);
  const name = String(rules?.meta?.name || `IP Rules v${version}`);

  await pg.query(
    `INSERT INTO ip_rule_sets (version, name, status, file_path, checksum_sha256, notes, activated_at)
     VALUES ($1, $2, 'active', $3, $4, $5, NOW())
     ON CONFLICT (version)
     DO UPDATE SET
       name = EXCLUDED.name,
       file_path = EXCLUDED.file_path,
       checksum_sha256 = EXCLUDED.checksum_sha256,
       notes = EXCLUDED.notes`,
    [version, name, filePath, checksum, String(rules?.meta?.notes || "")]
  );

  await pg.query(
    `UPDATE ip_rule_sets
     SET status = CASE WHEN version = $1 THEN 'active' ELSE 'retired' END
     WHERE status IN ('active','retired')`
  , [version]).catch(() => {});

  _cache = { rules, checksum, filePath, version };
  return _cache;
}

async function getActiveRuleSetRecord() {
  const { rows } = await pg.query(
    `SELECT version, name, file_path, checksum_sha256
     FROM ip_rule_sets
     WHERE status = 'active'
     ORDER BY version DESC
     LIMIT 1`
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

function loadOverlayIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function applyOverlays(baseRules, { brand, examiner } = {}) {
  let merged = deepClone(baseRules);
  if (!fs.existsSync(OVERLAYS_DIR)) return merged;

  if (brand) {
    const brandKey = String(brand).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const brandPath = path.join(OVERLAYS_DIR, `brand_${brandKey}.json`);
    const over = loadOverlayIfExists(brandPath);
    if (over) merged = deepMerge(merged, over);
  }

  if (examiner) {
    const exKey = normalizeExaminerName(examiner);
    const exPath = path.join(OVERLAYS_DIR, `examiner_${exKey}.json`);
    const over = loadOverlayIfExists(exPath);
    if (over) merged = deepMerge(merged, over);
  }

  return merged;
}

async function getRules() {
  if (_cache) return _cache;

  const active = await getActiveRuleSetRecord();
  if (!active) return ensureRuleSetRegistered();

  const loaded = loadRulesSync(active.file_path);
  _cache = {
    rules: loaded.rules,
    checksum: loaded.checksum,
    filePath: loaded.filePath,
    version: Number(active.version || loaded.rules?.meta?.version || 1),
    name: active.name || loaded.rules?.meta?.name || null,
  };
  return _cache;
}

async function getEffectiveRules(context = {}) {
  const base = await getRules();
  const effective = applyOverlays(base.rules, context);
  return {
    ...base,
    rules: effective,
  };
}

function scoreByWeights(text, weights = {}) {
  const s = String(text || "").toLowerCase();
  let score = 0;
  for (const [term, w] of Object.entries(weights || {})) {
    if (s.includes(String(term).toLowerCase())) score += Number(w) || 0;
  }
  return score;
}

function classifyDocumentByRules({ title, text, filePath }, rules) {
  const body = `${title || ""}\n${text || ""}\n${filePath || ""}`;
  const threshold = Number(rules?.document_classification?.threshold || 4);
  let best = { type: "other", score: 0 };

  for (const [type, cfg] of Object.entries(rules?.document_classification?.types || {})) {
    const score = scoreByWeights(body, cfg?.weights || {});
    if (score > best.score) best = { type, score };
  }

  if (best.score < threshold) return { doc_type: "other", score: best.score, confidence: 0.45 };
  const confidence = Math.min(0.99, 0.50 + best.score / 20);
  return { doc_type: best.type, score: best.score, confidence };
}

function detectIssuesByRules(text, rules) {
  const body = String(text || "");
  const out = [];
  for (const [issueType, cfg] of Object.entries(rules?.issue_detection || {})) {
    const score = scoreByWeights(body, cfg?.weights || {});
    const threshold = Number(cfg?.threshold || 4);
    if (score >= threshold) {
      out.push({
        issue_type: issueType,
        severity: cfg?.severity || "warn",
        score,
      });
    }
  }
  return out;
}

function buildDeadlineByRules(officeActionType, issueDate, rules) {
  if (!issueDate) return null;
  const key = officeActionType === "final" ? "office_action_final" : "office_action_nonfinal";
  const cfg = rules?.deadline_rules?.[key];
  if (!cfg) return null;
  const due = new Date(issueDate);
  due.setUTCMonth(due.getUTCMonth() + Number(cfg.months || 3));
  return {
    deadline_type: cfg.deadline_type || (officeActionType === "final" ? "oa_response_final" : "oa_response"),
    due_date: due.toISOString().slice(0, 10),
    source: "rules_engine",
  };
}

module.exports = {
  getRules,
  getEffectiveRules,
  ensureRuleSetRegistered,
  classifyDocumentByRules,
  detectIssuesByRules,
  buildDeadlineByRules,
  applyOverlays,
  OVERLAYS_DIR,
  DEFAULT_RULES_PATH,
};

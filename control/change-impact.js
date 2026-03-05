"use strict";

const HIGH_RISK_PATTERNS = [
  /webhook/i,
  /payment/i,
  /stripe/i,
  /auth/i,
  /schema/i,
  /migration/i,
  /queue/i,
  /dispatcher/i,
];

const MEDIUM_RISK_PATTERNS = [
  /api/i,
  /worker/i,
  /control\//i,
  /infra\//i,
  /route/i,
  /model/i,
];

function uniq(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function normalizeFilePath(fp) {
  return String(fp || "").replace(/\\/g, "/").trim();
}

function inferSymbolDomainsFromFiles(files = []) {
  const domains = new Set();
  for (const raw of files) {
    const file = normalizeFilePath(raw).toLowerCase();
    if (!file) continue;
    if (/(stripe|payment|checkout|billing)/.test(file)) domains.add("payments");
    if (/(webhook|hooks)/.test(file)) domains.add("webhooks");
    if (/(auth|oauth|token|login|session)/.test(file)) domains.add("auth");
    if (/(queue|dispatcher|worker|retry|dlq|bullmq|stream)/.test(file)) domains.add("queue");
    if (/(playwright|qa|test|spec)/.test(file)) domains.add("qa");
    if (/(ui|dashboard|frontend|react|vite|electron|swift)/.test(file)) domains.add("ui");
    if (/(schema|migration|sql|db|postgres|redis)/.test(file)) domains.add("infra");
    if (/(prompt|agent|llm|model-router|symbol-context)/.test(file)) domains.add("ai");
  }
  return Array.from(domains);
}

function mapDomainsToWorkerHints(domains = []) {
  const asSet = new Set(domains);
  const hints = new Set();
  if (asSet.has("payments") || asSet.has("webhooks") || asSet.has("auth") || asSet.has("infra") || asSet.has("queue")) {
    hints.add("io_heavy");
    hints.add("infra");
  }
  if (asSet.has("qa") || asSet.has("ui")) {
    hints.add("qa");
  }
  if (asSet.has("ai")) {
    hints.add("ai");
  }
  return Array.from(hints);
}

function riskWeight(file) {
  const normalized = normalizeFilePath(file);
  if (!normalized) return 0;
  if (HIGH_RISK_PATTERNS.some((re) => re.test(normalized))) return 10;
  if (MEDIUM_RISK_PATTERNS.some((re) => re.test(normalized))) return 5;
  return 2;
}

function impactBand(score) {
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function scoreChangeImpact(params = {}) {
  const files = uniq((params.changedFiles || []).map(normalizeFilePath)).filter(Boolean);
  const symbolCount = Array.isArray(params.dependentSymbols) ? params.dependentSymbols.length : 0;
  const entrypointCount = Array.isArray(params.entrypoints) ? params.entrypoints.length : 0;

  let fileRisk = 0;
  for (const file of files) fileRisk += riskWeight(file);
  const score = Math.max(0, Math.min(100, fileRisk + symbolCount * 2 + entrypointCount));

  return {
    score,
    band: impactBand(score),
    changed_files_count: files.length,
    dependent_symbol_count: symbolCount,
    entrypoint_count: entrypointCount,
  };
}

function targetExists(changedFiles, patterns = []) {
  for (const file of changedFiles) {
    const f = normalizeFilePath(file).toLowerCase();
    if (patterns.some((re) => re.test(f))) return true;
  }
  return false;
}

function generateTestTargets(params = {}) {
  const changedFiles = uniq((params.changedFiles || []).map(normalizeFilePath)).filter(Boolean);
  const domains = uniq(params.domains || inferSymbolDomainsFromFiles(changedFiles));
  const commands = new Set();
  const checks = new Set(["npm run -s status:redgreen"]);

  if (domains.includes("payments") || targetExists(changedFiles, [/stripe|payment|checkout|billing/])) {
    commands.add("npm run -s stripe:health:check");
  }
  if (domains.includes("webhooks") || targetExists(changedFiles, [/webhook/])) {
    commands.add("npm run -s webhook:health:check");
  }
  if (domains.includes("auth") || targetExists(changedFiles, [/auth|oauth|token/])) {
    commands.add("npm run -s credit:oauth:check");
  }
  if (domains.includes("qa") || targetExists(changedFiles, [/qa|playwright|spec|test/])) {
    commands.add("npm run -s flow:regression:pulse");
  }
  if (domains.includes("queue") || domains.includes("infra") || targetExists(changedFiles, [/dispatcher|queue|retry|dlq|migration|schema|db|postgres|redis/])) {
    checks.add("npm run -s schema:audit:json");
    checks.add("npm run -s audit:runtime");
  }

  return {
    domains,
    checks: Array.from(checks),
    targeted_commands: Array.from(commands),
  };
}

function compactSymbolContext(params = {}) {
  const symbols = Array.isArray(params.dependentSymbols) ? params.dependentSymbols : [];
  const compressed = symbols.slice(0, 8).map((s) => ({
    id: s.id,
    file: s.file,
    kind: s.kind,
    line: s.line,
  }));
  return {
    count: symbols.length,
    compressed,
  };
}

module.exports = {
  inferSymbolDomainsFromFiles,
  mapDomainsToWorkerHints,
  scoreChangeImpact,
  generateTestTargets,
  compactSymbolContext,
};


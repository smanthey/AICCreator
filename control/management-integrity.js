"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { logIntegrityEvent } = require("./integrity-events");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "agent-state", "shared-context", "management-integrity-state.json");
const SYMBOL_REPORT_PATH = path.join(ROOT, "scripts", "reports", "symbolic-qa-hub-latest.json");

const DEFAULTS = {
  maxRetriesPerLane: Math.max(1, Number(process.env.MGMT_MAX_RETRIES || "3") || 3),
  symbolIndexMaxAgeHours: Math.max(1, Number(process.env.MGMT_SYMBOL_INDEX_MAX_AGE_HOURS || "24") || 24),
  minSymbolQueryCount: Math.max(1, Number(process.env.MGMT_MIN_SYMBOL_QUERIES || "2") || 2),
  minDistinctSymbolOps: Math.max(1, Number(process.env.MGMT_MIN_DISTINCT_SYMBOL_OPS || "2") || 2),
  repoMapMaxAgeHours: Math.max(1, Number(process.env.MGMT_REPOMAP_MAX_AGE_HOURS || "24") || 24),
  requireIndexAndRepoMapper: !/^(0|false|no)$/i.test(String(process.env.MGMT_REQUIRE_INDEX_AND_REPOMAP || "true")),
  requireVerifiedSymbolIds: !/^(0|false|no)$/i.test(String(process.env.MGMT_REQUIRE_VERIFIED_SYMBOL_IDS || "true")),
  minVerifiedSymbolIds: Math.max(1, Number(process.env.MGMT_MIN_VERIFIED_SYMBOL_IDS || "1") || 1),
  enforceOutputContract: !/^(0|false|no)$/i.test(String(process.env.MGMT_ENFORCE_OUTPUT_CONTRACT || "true")),
};

const LANE_REPO_MAP = {
  cookiespass: "local/cookiespass",
  payclaw: "local/payclaw",
  gocrawdaddy: "local/gocrawdaddy",
};

const LANE_REPO_DIR_MAP = {
  cookiespass: "CookiesPass",
  payclaw: "payclaw",
  gocrawdaddy: "GoCrawdaddy",
};

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readFirstJson(paths) {
  for (const p of paths) {
    const value = readJsonSafe(p);
    if (value && typeof value === "object") return value;
  }
  return null;
}

function writeJsonSafe(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function parseTrailingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const candidates = [];
  const seen = new Set();

  function pushCandidate(candidate) {
    const value = String(candidate || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed);
      }
    } catch {
      // ignore invalid candidate
    }
  }

  // Full payload first.
  pushCandidate(raw);

  // Prefer explicit fenced JSON blocks when present.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenced.exec(raw))) {
    pushCandidate(match[1]);
  }

  // Parse balanced JSON object fragments from the tail backward.
  for (let end = raw.length - 1; end >= 0; end--) {
    if (raw[end] !== "}") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = end; i >= 0; i--) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "}") depth += 1;
      else if (ch === "{") {
        depth -= 1;
        if (depth === 0) {
          pushCandidate(raw.slice(i, end + 1));
          break;
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Rank by output-contract relevance first, then by latest appearance.
  const score = (obj) => {
    let s = 0;
    if (obj.output_contract && typeof obj.output_contract === "object") s += 8;
    if (Object.prototype.hasOwnProperty.call(obj, "repo")) s += 2;
    if (Object.prototype.hasOwnProperty.call(obj, "symbol_ids")) s += 2;
    if (Object.prototype.hasOwnProperty.call(obj, "index_run")) s += 2;
    if (Object.prototype.hasOwnProperty.call(obj, "repo_map_path")) s += 2;
    if (Object.prototype.hasOwnProperty.call(obj, "changed_files")) s += 2;
    if (Object.prototype.hasOwnProperty.call(obj, "tests_passed")) s += 2;
    if (obj.report && typeof obj.report === "object") s += 1;
    return s;
  };

  let best = candidates[candidates.length - 1];
  let bestScore = score(best);
  for (const c of candidates) {
    const sc = score(c);
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }
  return best;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[0-9a-f]{8,40}/g, "<hex>")
    .replace(/\b\d{4}-\d{2}-\d{2}[^\s]*/g, "<ts>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function classifyLane(agentId, agent = {}) {
  const id = String(agentId || "").toLowerCase();
  const text = `${id} ${String(agent?.name || "")} ${String(agent?.job_description || "")} ${String(agent?.primary_command || "")}`.toLowerCase();
  if (id.includes("payclaw") || text.includes("payclaw")) return "payclaw";
  if (id.includes("gocrawdaddy") || text.includes("gocrawdaddy")) return "gocrawdaddy";
  if (id.includes("cookiespass") || text.includes("cookiespass")) return "cookiespass";
  return "shared";
}

function inferRepo(agentId, agent = {}, payload = {}) {
  const lane = classifyLane(agentId, agent);
  if (LANE_REPO_MAP[lane]) return LANE_REPO_MAP[lane];

  const candidates = [
    payload.repo,
    payload.target_repo,
    payload.repository,
    payload?.payload?.repo,
    payload?.payload?.target_repo,
  ].filter(Boolean);
  if (candidates.length) return String(candidates[0]);

  const id = String(agentId || "").toLowerCase();
  if (id.includes("research")) return "local/research";
  return "local/claw-architect";
}

function classifyTask(agentId, agent = {}) {
  const blob = `${agentId} ${agent.name || ""} ${agent.job_description || ""} ${agent.primary_command || ""}`.toLowerCase();
  const research = /research|analysis|intel/.test(blob);
  const implementation = /build|builder|development|debug|fix|implement|cookiespass|payclaw|gocrawdaddy|code/.test(blob);
  return { research, implementation };
}

function resolveRepoDir(repo, lane = "shared") {
  const raw = String(repo || "").trim();
  const candidateDirs = [];
  if (raw && path.isAbsolute(raw)) candidateDirs.push(raw);

  const short = raw.replace(/^local\//, "");
  if (short) {
    candidateDirs.push(path.join(ROOT, "..", short));
    candidateDirs.push(path.join(ROOT, "..", "claw-repos", short));
    candidateDirs.push(path.join(ROOT, "..", "claw-repos", short.toLowerCase()));
  }
  if (LANE_REPO_DIR_MAP[lane]) {
    candidateDirs.push(path.join(ROOT, "..", "claw-repos", LANE_REPO_DIR_MAP[lane]));
  }
  candidateDirs.push(ROOT);

  for (const dir of candidateDirs) {
    try {
      const stat = fs.statSync(dir);
      if (stat.isDirectory() && fs.existsSync(path.join(dir, ".git"))) {
        return dir;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function runGit(repoDir, args) {
  if (!repoDir) return { ok: false, code: 1, stdout: "", stderr: "repo_not_found" };
  const r = spawnSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function extractFirstPathLike(text) {
  const m = String(text || "").match(/\b(?:artifacts?|reports?)\/[\w./:-]+\b/i);
  return m ? m[0] : null;
}

function hasPassingTestSignal(trailing, reportLatest) {
  const checks = [
    ...(Object.values(reportLatest?.checks || {})),
    ...(Object.values(reportLatest?.verify || {})),
    ...(Object.values(trailing?.checks || {})),
    ...(Object.values(trailing?.verify || {})),
  ];
  for (const c of checks) {
    if (!c || typeof c !== "object") continue;
    const command = String(c.command || "").toLowerCase();
    const isTestLike = /\b(test|jest|vitest|pytest|mocha|cypress|playwright)\b/.test(command);
    if (isTestLike && c.ok === true && Number(c.code || 0) === 0) {
      return { ok: true, source: c.command || "test_command" };
    }
  }
  return { ok: false, source: null };
}

function collectEvidence(out, trailing, reportLatest, repo, lane) {
  const combined = `${out?.stdout_tail || ""}\n${out?.stderr_tail || ""}`;
  const repoDir = resolveRepoDir(repo, lane);
  const strict = {
    repo_dir: repoDir,
    commit_verified: false,
    diff_verified: false,
    test_verified: false,
    artifact_verified: false,
  };

  const commitShaRaw = String(trailing?.commit_sha || reportLatest?.commit_sha || "").trim();
  const commitSha = /^[0-9a-f]{7,40}$/i.test(commitShaRaw) ? commitShaRaw : null;
  let changedFilesFromGit = null;
  let diffStatsFromGit = null;

  if (commitSha && repoDir) {
    const verify = runGit(repoDir, ["rev-parse", "--verify", `${commitSha}^{commit}`]);
    strict.commit_verified = verify.ok;
    if (verify.ok) {
      const names = runGit(repoDir, ["show", "--pretty=format:", "--name-only", commitSha]);
      const stat = runGit(repoDir, ["show", "--pretty=format:", "--stat", commitSha]);
      if (names.ok) {
        changedFilesFromGit = names.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      }
      if (stat.ok) {
        const line = stat.stdout.split(/\r?\n/).map((x) => x.trim()).find((x) => /\d+\s+files?\s+changed/i.test(x)) || null;
        diffStatsFromGit = line;
      }
      strict.diff_verified = Boolean((changedFilesFromGit && changedFilesFromGit.length > 0) || diffStatsFromGit);
    }
  }

  const testSignal = hasPassingTestSignal(trailing, reportLatest);
  strict.test_verified = testSignal.ok;

  const artifactCandidate =
    String(trailing?.artifact_path || reportLatest?.artifact_path || "").trim() ||
    extractFirstPathLike(combined);
  let artifactAbs = null;
  if (artifactCandidate) {
    artifactAbs = path.isAbsolute(artifactCandidate)
      ? artifactCandidate
      : path.join(ROOT, artifactCandidate);
    strict.artifact_verified = fs.existsSync(artifactAbs);
  }

  const changedFilesJson =
    Array.isArray(trailing?.changed_files) && trailing.changed_files.length > 0
      ? trailing.changed_files
      : Array.isArray(reportLatest?.changed_files) && reportLatest.changed_files.length > 0
        ? reportLatest.changed_files
        : [];

  const changedFiles = changedFilesFromGit && changedFilesFromGit.length > 0 ? changedFilesFromGit : changedFilesJson;
  const diffStats = diffStatsFromGit || String(trailing?.diff_stats || reportLatest?.diff_stats || "").trim() || undefined;
  const testOutput = testSignal.ok ? testSignal.source : undefined;
  const artifactPath = strict.artifact_verified ? artifactAbs : undefined;

  const types = [];
  if (strict.commit_verified) types.push("commit_sha");
  if (strict.diff_verified || changedFiles.length > 0) types.push("changed_files_or_diff_stats");
  if (strict.test_verified) types.push("passing_test_output");
  if (strict.artifact_verified) types.push("artifact_path");

  return {
    ok: types.length > 0,
    types,
    commit_sha: strict.commit_verified ? commitSha : undefined,
    changed_files: changedFiles.length > 0 ? changedFiles : undefined,
    diff_stats: diffStats,
    test_output: testOutput,
    artifact_path: artifactPath,
    strict,
  };
}

function extractSymbolIds(...sources) {
  const joined = sources.map((x) => JSON.stringify(x || "")).join("\n");
  const rx = /[A-Za-z0-9_./-]+::[A-Za-z0-9_.$<>-]+#(?:function|method|class|type)/g;
  const found = new Set();
  let m;
  while ((m = rx.exec(joined)) !== null) found.add(m[0]);
  return Array.from(found).slice(0, 50);
}

function normalizeRepoKey(repo) {
  const raw = String(repo || "").trim();
  if (!raw) return "local/claw-architect";
  if (raw.startsWith("local/")) return raw;
  if (raw.includes("/")) return raw;
  return `local/${raw}`;
}

function repoIndexPath(repoKey) {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return null;
  return path.join(home, ".code-index", `${String(repoKey).replace(/\//g, "-")}.json`);
}

function loadRepoSymbolSet(repoKey) {
  const indexPath = repoIndexPath(repoKey);
  if (!indexPath) return null;
  const idx = readJsonSafe(indexPath);
  const symbols = Array.isArray(idx?.symbols) ? idx.symbols : [];
  if (!symbols.length) return null;
  const ids = new Set();
  for (const s of symbols) {
    if (s && typeof s.id === "string" && s.id) {
      ids.add(s.id);
    }
  }
  return ids.size ? ids : null;
}

function verifySymbolIdsForRepo(repo, symbolIds) {
  const repoKey = normalizeRepoKey(repo);
  const set = loadRepoSymbolSet(repoKey);
  if (!set) {
    return {
      repo_key: repoKey,
      index_available: false,
      verified_count: 0,
      invalid_count: symbolIds.length,
      invalid_symbol_ids: symbolIds.slice(0, 10),
    };
  }
  const verified = [];
  const invalid = [];
  for (const id of symbolIds) {
    if (set.has(id)) verified.push(id);
    else invalid.push(id);
  }
  return {
    repo_key: repoKey,
    index_available: true,
    verified_count: verified.length,
    invalid_count: invalid.length,
    verified_symbol_ids: verified.slice(0, 20),
    invalid_symbol_ids: invalid.slice(0, 10),
  };
}

function repoMapCandidates(repo) {
  const base = path.basename(String(repo || "").replace(/^local\//, ""));
  return [
    path.join(ROOT, "scripts", "reports", "repomaps", `${base}-repomap.md`),
    path.join(ROOT, "scripts", "reports", `${base}-repomap.md`),
    path.join(ROOT, "reports", "repomaps", `${base}-repomap.md`),
    path.join(ROOT, "reports", `${base}-repomap.md`),
  ];
}

function repoMapFreshness(repo) {
  for (const fp of repoMapCandidates(repo)) {
    try {
      const stat = fs.statSync(fp);
      const ageHours = (Date.now() - Number(stat.mtimeMs || 0)) / 3600000;
      return {
        exists: true,
        path: fp,
        age_hours: Number(ageHours.toFixed(2)),
        fresh: ageHours <= DEFAULTS.repoMapMaxAgeHours,
      };
    } catch {
      // continue
    }
  }
  return { exists: false, path: null, age_hours: null, fresh: false };
}

function analyzeSymbolToolUsage(out, agent = {}, trailing = null, reportLatest = null) {
  const text = [
    agent.primary_command || "",
    out.stdout_tail || "",
    out.stderr_tail || "",
    JSON.stringify(trailing || {}),
    JSON.stringify(reportLatest || {}),
  ].join("\n");

  const allMatches = text.match(
    /\b(index_repo|index_folder|search_symbols|get_symbol|get_symbols|get_repo_outline|get_file_outline|search_text|repo_mapper)\b/gi
  ) || [];
  const normalized = allMatches.map((x) => x.toLowerCase());
  const opSet = new Set(normalized);
  const indexOps = normalized.filter((x) => x === "index_repo" || x === "index_folder");
  const queryOps = normalized.filter((x) =>
    x === "search_symbols" ||
    x === "get_symbol" ||
    x === "get_symbols" ||
    x === "get_repo_outline" ||
    x === "get_file_outline" ||
    x === "search_text"
  );
  const mapperOps = normalized.filter((x) => x === "repo_mapper");
  const hasRepoMapperEvidence =
    mapperOps.length > 0 ||
    /\brepo:map\b|\bscripts\/repo-map\.js\b|\bpython\s+-m\s+repo_mapper\b/i.test(text);

  return {
    query_count: allMatches.length,
    distinct_ops_count: opSet.size,
    distinct_ops: Array.from(opSet),
    index_ops_count: indexOps.length,
    query_ops_count: queryOps.length,
    repo_mapper_count: mapperOps.length,
    has_index_ops: indexOps.length > 0,
    has_repo_mapper: hasRepoMapperEvidence,
  };
}

function countSymbolQueries(out, agent = {}, trailing = null, reportLatest = null) {
  return analyzeSymbolToolUsage(out, agent, trailing, reportLatest).query_count;
}

function extractOutputContractObject(out, trailing, reportLatest) {
  const fromTrailingContract = trailing?.output_contract;
  if (fromTrailingContract && typeof fromTrailingContract === "object") return fromTrailingContract;
  const trailingLooksLikeContract =
    trailing &&
    typeof trailing === "object" &&
    ("repo" in trailing || "symbol_ids" in trailing || "index_run" in trailing || "repo_map_path" in trailing);
  if (trailingLooksLikeContract) return trailing;

  const fromReportContract = reportLatest?.output_contract;
  if (fromReportContract && typeof fromReportContract === "object") return fromReportContract;
  const reportLooksLikeContract =
    reportLatest &&
    typeof reportLatest === "object" &&
    ("repo" in reportLatest || "symbol_ids" in reportLatest || "index_run" in reportLatest || "repo_map_path" in reportLatest);
  if (reportLooksLikeContract) return reportLatest;

  const outContract = out?.output_contract;
  if (outContract && typeof outContract === "object") return outContract;

  return null;
}

function evaluateOutputContract({ out, trailing, reportLatest, expectedRepo }) {
  const missing = [];
  const contract = extractOutputContractObject(out, trailing, reportLatest);
  if (!contract || typeof contract !== "object") {
    return {
      required: DEFAULTS.enforceOutputContract,
      ok: false,
      missing: ["final_output_contract_json_block"],
      contract: null,
    };
  }

  const repo = String(contract.repo || "").trim();
  if (!repo) missing.push("repo");
  else if (expectedRepo && normalizeRepoKey(repo) !== normalizeRepoKey(expectedRepo)) missing.push("repo_mismatch");

  if (!Array.isArray(contract.symbol_ids)) {
    missing.push("symbol_ids");
  } else if (contract.symbol_ids.length === 0) {
    missing.push("symbol_ids_non_empty");
  }

  if (typeof contract.index_run !== "boolean") missing.push("index_run");
  if (typeof contract.repo_map_path !== "string" || !contract.repo_map_path.trim()) missing.push("repo_map_path");
  if (!Array.isArray(contract.changed_files)) missing.push("changed_files");
  if (typeof contract.tests_passed !== "boolean") missing.push("tests_passed");

  return {
    required: DEFAULTS.enforceOutputContract,
    ok: missing.length === 0,
    missing,
    contract,
  };
}

function evaluateImplementationGitEvidence({ out, trailing, reportLatest, repo, lane, required }) {
  if (!required) {
    return {
      required: false,
      ok: true,
      missing: [],
      git_head: null,
      git_diff_name_only: [],
      repo_dir: null,
    };
  }

  const missing = [];
  const repoDir = resolveRepoDir(repo, lane);
  const contract = extractOutputContractObject(out, trailing, reportLatest) || {};

  let gitHead = String(contract.git_head || trailing?.git_head || reportLatest?.git_head || "").trim();
  let gitDiff = [];
  if (Array.isArray(contract.git_diff_name_only)) gitDiff = contract.git_diff_name_only.filter(Boolean).map((x) => String(x));
  else if (Array.isArray(trailing?.git_diff_name_only)) gitDiff = trailing.git_diff_name_only.filter(Boolean).map((x) => String(x));
  else if (Array.isArray(reportLatest?.git_diff_name_only)) gitDiff = reportLatest.git_diff_name_only.filter(Boolean).map((x) => String(x));

  // Probe the repo directly to ensure the evidence is real and machine-verifiable.
  if (repoDir) {
    const rev = runGit(repoDir, ["rev-parse", "HEAD"]);
    if (rev.ok && !gitHead) gitHead = String(rev.stdout || "").trim();

    const diff = runGit(repoDir, ["diff", "--name-only"]);
    if (diff.ok && gitDiff.length === 0) {
      gitDiff = String(diff.stdout || "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  if (!/^[0-9a-f]{7,40}$/i.test(String(gitHead || ""))) missing.push("git_rev_parse_head");
  if (!Array.isArray(gitDiff) || gitDiff.length === 0) missing.push("git_diff_name_only_non_empty");

  return {
    required: true,
    ok: missing.length === 0,
    missing,
    git_head: gitHead || null,
    git_diff_name_only: Array.isArray(gitDiff) ? gitDiff : [],
    repo_dir: repoDir,
  };
}

function evaluateResearchContract(out, trailing, reportLatest) {
  const obj = trailing && typeof trailing === "object" ? trailing : (reportLatest || {});
  const text = [JSON.stringify(obj), out.stdout_tail || "", out.stderr_tail || ""].join("\n");

  const rankedCandidates =
    (Array.isArray(obj.ranked_implementation_candidates) && obj.ranked_implementation_candidates.length > 0) ||
    (Array.isArray(obj.implementation_candidates) && obj.implementation_candidates.some((x) => x && (x.rank != null || x.score != null))) ||
    /ranked implementation candidates|candidate\s*#?1/i.test(text);

  const symbolTargets =
    (Array.isArray(obj.symbol_targets) && obj.symbol_targets.some((x) => x && x.repo && x.file && x.symbol)) ||
    /symbol[_\s-]*targets|repo\s*[:=].*file\s*[:=].*symbol\s*[:=]/i.test(text);

  const acceptanceCriteria =
    (Array.isArray(obj.acceptance_criteria) && obj.acceptance_criteria.length > 0) ||
    (typeof obj.acceptance_criteria === "string" && obj.acceptance_criteria.trim().length > 0) ||
    /acceptance criteria|apply this change/i.test(text);

  const missing = [];
  if (!rankedCandidates) missing.push("ranked_implementation_candidates");
  if (!symbolTargets) missing.push("exact_symbol_targets(repo,file,symbol)");
  if (!acceptanceCriteria) missing.push("apply_change_acceptance_criteria");

  return {
    ok: missing.length === 0,
    ranked_candidates: rankedCandidates,
    symbol_targets: symbolTargets,
    acceptance_criteria: acceptanceCriteria,
    missing,
  };
}

function loadState() {
  const raw = readJsonSafe(STATE_PATH);
  if (raw && typeof raw === "object") return raw;
  return {
    version: 1,
    updated_at: new Date(0).toISOString(),
    entries: {},
    lane_entries: {},
    global_lane_quarantine: {},
    quarantine_queue: [],
  };
}

function saveState(state) {
  state.updated_at = new Date().toISOString();
  writeJsonSafe(STATE_PATH, state);
}

function preRunGate({ runnerType, agentId, agent, dryRun }) {
  const lane = classifyLane(agentId, agent);
  const repo = inferRepo(agentId, agent, {});
  const key = `${runnerType}:${lane}:${repo}:${agentId}`;
  const laneKey = `${runnerType}:${lane}:${repo}`;
  const state = loadState();
  const entry = state.entries[key] || {};
  const laneEntry = state.lane_entries?.[laneKey] || {};
  const globalLaneQ = state.global_lane_quarantine?.[lane] || {};

  if (globalLaneQ?.active || entry?.quarantined?.active || laneEntry?.quarantined?.active) {
    const q = entry?.quarantined?.active ? entry.quarantined : (laneEntry?.quarantined || {});
    const gq = globalLaneQ?.active ? globalLaneQ : null;
    return {
      blocked: true,
      key,
      lane,
      repo,
      reason: gq?.reason || q.reason || "QUARANTINED",
      required_action: gq?.required_action || q.required_action || "Human unblock required",
    };
  }

  if (dryRun) {
    return {
      blocked: false,
      key,
      lane,
      repo,
      warn: "DRY_RUN mode cannot satisfy evidence-gated completion.",
    };
  }

  return { blocked: false, key, lane, repo };
}

async function evaluateAndRecordRunIntegrity({ runnerType, agentId, agent, out }) {
  const state = loadState();
  const now = new Date().toISOString();

  const trailing = parseTrailingJson(`${out.stdout_tail || ""}\n${out.stderr_tail || ""}`);
  const reportLatest =
    trailing?.report?.latestPath && fs.existsSync(trailing.report.latestPath)
      ? readJsonSafe(trailing.report.latestPath)
      : null;

  const lane = classifyLane(agentId, agent);
  const repo = inferRepo(agentId, agent, trailing || reportLatest || {});
  const key = `${runnerType}:${lane}:${repo}:${agentId}`;
  const laneKey = `${runnerType}:${lane}:${repo}`;
  const taskClass = classifyTask(agentId, agent);

  const entry = state.entries[key] || {
    retries: 0,
    duplicate_streak: 0,
    last_fingerprint: null,
    quarantined: { active: false },
  };
  const laneEntry = state.lane_entries?.[laneKey] || {
    retries: 0,
    quarantined: { active: false },
  };

  const reasons = [];
  const evidence = collectEvidence(out, trailing, reportLatest, repo, lane);
  if (!evidence.ok) {
    reasons.push("EVIDENCE_GATE_MISSING: require commit SHA, diff stats/changed files, passing test output, or artifact path.");
  }

  const symbolPreflight = {
    required: Boolean(taskClass.research || taskClass.implementation),
    freshness_ok: true,
    freshness_age_hours: null,
    repomap_ok: true,
    repomap_age_hours: null,
    repomap_path: null,
    min_query_count: DEFAULTS.minSymbolQueryCount,
    min_distinct_ops: DEFAULTS.minDistinctSymbolOps,
    query_count: 0,
    distinct_ops_count: 0,
    distinct_ops: [],
    has_index_ops: false,
    has_repo_mapper: false,
    require_index_and_repomapper: DEFAULTS.requireIndexAndRepoMapper,
    symbol_ids: [],
    verified_symbol_id_count: 0,
    invalid_symbol_ids: [],
    repo_index_available: true,
    missing: [],
    ok: true,
  };

  if (symbolPreflight.required) {
    const symbolReport = readFirstJson([
      SYMBOL_REPORT_PATH,
      path.join(ROOT, "reports", "symbolic-qa-hub-latest.json"),
    ]);
    const generatedAt = symbolReport?.generated_at ? Date.parse(symbolReport.generated_at) : NaN;
    if (Number.isFinite(generatedAt)) {
      const ageHours = (Date.now() - generatedAt) / 3600000;
      symbolPreflight.freshness_age_hours = Number(ageHours.toFixed(2));
      symbolPreflight.freshness_ok = ageHours <= DEFAULTS.symbolIndexMaxAgeHours;
    } else {
      symbolPreflight.freshness_ok = false;
    }

    const usage = analyzeSymbolToolUsage(out, agent, trailing, reportLatest);
    symbolPreflight.query_count = usage.query_count;
    symbolPreflight.distinct_ops_count = usage.distinct_ops_count;
    symbolPreflight.distinct_ops = usage.distinct_ops;
    symbolPreflight.has_index_ops = usage.has_index_ops;
    symbolPreflight.has_repo_mapper = usage.has_repo_mapper;
    symbolPreflight.symbol_ids = extractSymbolIds(out.stdout_tail, out.stderr_tail, trailing, reportLatest);

    const mapFreshness = repoMapFreshness(repo);
    symbolPreflight.repomap_ok = mapFreshness.fresh;
    symbolPreflight.repomap_age_hours = mapFreshness.age_hours;
    symbolPreflight.repomap_path = mapFreshness.path;

    const symbolProof = verifySymbolIdsForRepo(repo, symbolPreflight.symbol_ids);
    symbolPreflight.repo_index_available = symbolProof.index_available;
    symbolPreflight.verified_symbol_id_count = symbolProof.verified_count;
    symbolPreflight.invalid_symbol_ids = symbolProof.invalid_symbol_ids || [];

    if (!symbolPreflight.freshness_ok) symbolPreflight.missing.push("index_freshness_check");
    if (symbolPreflight.query_count < DEFAULTS.minSymbolQueryCount) {
      symbolPreflight.missing.push("minimum_symbol_query_count");
    }
    if (symbolPreflight.distinct_ops_count < DEFAULTS.minDistinctSymbolOps) {
      symbolPreflight.missing.push("minimum_distinct_symbol_operations");
    }
    if (DEFAULTS.requireIndexAndRepoMapper && !symbolPreflight.has_index_ops) {
      symbolPreflight.missing.push("index_operation_evidence");
    }
    if (DEFAULTS.requireIndexAndRepoMapper && !symbolPreflight.has_repo_mapper) {
      symbolPreflight.missing.push("repo_mapper_evidence");
    }
    if (!symbolPreflight.repomap_ok) {
      symbolPreflight.missing.push(mapFreshness.exists ? "repomap_freshness_check" : "repomap_missing");
    }
    if (symbolPreflight.symbol_ids.length === 0) {
      symbolPreflight.missing.push("captured_symbol_ids_in_output");
    } else if (DEFAULTS.requireVerifiedSymbolIds) {
      if (!symbolPreflight.repo_index_available) {
        symbolPreflight.missing.push("repo_index_missing_for_symbol_validation");
      } else if (symbolPreflight.verified_symbol_id_count < DEFAULTS.minVerifiedSymbolIds) {
        symbolPreflight.missing.push("verified_symbol_ids_for_target_repo");
      }
    }

    symbolPreflight.ok = symbolPreflight.missing.length === 0;
    if (!symbolPreflight.ok) {
      reasons.push(`SYMBOL_PREFLIGHT_FAILED: ${symbolPreflight.missing.join(", ")}`);
    }
  }

  const researchContract = {
    required: Boolean(taskClass.research),
    ok: true,
    missing: [],
  };

  if (researchContract.required) {
    const contract = evaluateResearchContract(out, trailing, reportLatest);
    researchContract.ok = contract.ok;
    researchContract.missing = contract.missing;
    if (!contract.ok) {
      reasons.push(`RESEARCH_CONTRACT_INCOMPLETE: ${contract.missing.join(", ")}`);
    }
  }

  const outputContract = evaluateOutputContract({
    out,
    trailing,
    reportLatest,
    expectedRepo: repo,
  });
  if (outputContract.required && !outputContract.ok) {
    reasons.push(`OUTPUT_CONTRACT_MISSING: ${outputContract.missing.join(", ")}`);
  }

  const gitEvidence = evaluateImplementationGitEvidence({
    out,
    trailing,
    reportLatest,
    repo,
    lane,
    required: Boolean(taskClass.implementation),
  });
  if (gitEvidence.required && !gitEvidence.ok) {
    reasons.push(`GIT_EVIDENCE_MISSING: ${gitEvidence.missing.join(", ")}`);
  }

  if (out.dry_run) {
    reasons.push("DRY_RUN_NO_EVIDENCE: dry-run outputs cannot be marked completed.");
  }

  const normalized = normalizeText(`${out.stdout_tail || ""}\n${out.stderr_tail || ""}`);
  const fingerprint = hashText(normalized);
  if (entry.last_fingerprint && entry.last_fingerprint === fingerprint) {
    entry.duplicate_streak = Number(entry.duplicate_streak || 0) + 1;
  } else {
    entry.duplicate_streak = 1;
  }

  let blockedLoop = false;
  if (entry.duplicate_streak >= 2) {
    blockedLoop = true;
    reasons.push("BLOCKED_LOOP: near-identical output repeated for same task type + repo.");
  }

  const commandOk = Boolean(out.ok);
  const effectiveOk = commandOk && reasons.length === 0;

  if (!effectiveOk) {
    entry.retries = Number(entry.retries || 0) + 1;
    laneEntry.retries = Number(laneEntry.retries || 0) + 1;
  } else {
    entry.retries = 0;
    laneEntry.retries = 0;
    entry.quarantined = { active: false };
    laneEntry.quarantined = { active: false };
  }

  const quarantine = {
    active: false,
    reason: null,
    required_action: null,
  };

  if (blockedLoop) {
    quarantine.active = true;
    quarantine.reason = "BLOCKED_LOOP";
    quarantine.required_action = "Human review required: change objective/inputs before re-enabling this lane.";
  } else if (laneEntry.retries > DEFAULTS.maxRetriesPerLane) {
    quarantine.active = true;
    quarantine.reason = "RETRY_BUDGET_EXHAUSTED";
    quarantine.required_action = "Human unblock required: resolve blocker, provide new acceptance criteria, then release quarantine.";
  }

  if (quarantine.active) {
    entry.quarantined = {
      active: true,
      reason: quarantine.reason,
      required_action: quarantine.required_action,
      at: now,
    };
    laneEntry.quarantined = {
      active: true,
      reason: quarantine.reason,
      required_action: quarantine.required_action,
      at: now,
    };
    state.quarantine_queue = Array.isArray(state.quarantine_queue) ? state.quarantine_queue : [];
    state.quarantine_queue.push({
      at: now,
      key,
      lane,
      repo,
      agent_id: agentId,
      reason: quarantine.reason,
      required_action: quarantine.required_action,
      retries: entry.retries,
      lane_retries: laneEntry.retries,
    });
    if (state.quarantine_queue.length > 200) {
      state.quarantine_queue = state.quarantine_queue.slice(-200);
    }
  }

  entry.last_fingerprint = fingerprint;
  entry.last_summary = reasons.length ? reasons.join(" | ") : "OK";
  entry.last_seen_at = now;
  entry.last_status = effectiveOk ? "COMPLETED" : (blockedLoop ? "BLOCKED_LOOP" : (quarantine.active ? "BLOCKED" : "FAILED"));

  state.entries[key] = entry;
  state.lane_entries = state.lane_entries || {};
  state.lane_entries[laneKey] = laneEntry;
  saveState(state);
  const result = {
    key,
    lane,
    repo,
    command_ok: commandOk,
    effective_ok: effectiveOk,
    status: effectiveOk ? "COMPLETED" : (blockedLoop ? "BLOCKED_LOOP" : (quarantine.active ? "BLOCKED" : "FAILED")),
    fail_closed: !effectiveOk,
    reasons,
    evidence,
    symbol_preflight: symbolPreflight,
    output_contract: outputContract,
    git_evidence: gitEvidence,
    research_contract: researchContract,
    loop: {
      duplicate_streak: entry.duplicate_streak,
      blocked_loop: blockedLoop,
      fingerprint,
    },
    retry: {
      current: entry.retries,
      lane_current: laneEntry.retries,
      budget: DEFAULTS.maxRetriesPerLane,
    },
    quarantine,
  };

  try {
    await logIntegrityEvent({
      event_type: "RUN_INTEGRITY",
      lane,
      repo,
      runner_type: runnerType,
      agent_id: agentId,
      status: result.status,
      reason: result.reasons.join(" | ") || null,
      payload: result,
    });
  } catch {
    // Non-fatal: integrity gate must not fail from telemetry persistence issues.
  }

  return result;
}

module.exports = {
  DEFAULTS,
  STATE_PATH,
  loadState,
  classifyLane,
  inferRepo,
  preRunGate,
  evaluateAndRecordRunIntegrity,
};

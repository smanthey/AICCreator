#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueClosedLoopChain } = require("../control/closed-loop");
const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const MISSION_PATH = path.join(ROOT, "config", "mission-openclaw-architect.json");
const REPORT_PATH = path.join(ROOT, "reports", "daily-feature-rotation-latest.json");
const EXEMPLAR_REPOS_PATH = path.join(ROOT, "data", "exemplar-repos.json");

const FEATURES_PER_REPO = Math.max(
  1,
  Math.min(2, Number.parseInt(String(process.env.DAILY_FEATURE_ROTATION_PER_REPO || "2"), 10) || 2)
);
const MAX_REPOS = Math.max(1, Number.parseInt(String(process.env.DAILY_FEATURE_ROTATION_MAX_REPOS || "40"), 10) || 40);
const PRIORITY_REPOS = String(
  process.env.DAILY_FEATURE_ROTATION_PRIORITY_REPOS ||
    "local/quantfusion,local/payclaw,local/CookiesPass,local/TempeCookiesPass,local/claw-architect"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

const FEATURE_CATALOG = [
  {
    key: "stripe_checkout",
    label: "Stripe Checkout reliability",
    objective:
      "Harden checkout session creation for retries, metadata integrity, and deterministic error handling.",
    exemplar_tags: ["stripe", "checkout", "payment"],
  },
  {
    key: "stripe_webhooks",
    label: "Stripe webhook idempotency",
    objective:
      "Implement strict webhook signature verification, replay protection, idempotent event handling, and clear audit status updates.",
    exemplar_tags: ["stripe", "webhook", "idempotency"],
  },
  {
    key: "sms_compliance",
    label: "Telnyx SMS compliance flow",
    objective:
      "Enforce STOP/HELP handling, opt-out persistence, message template safety, and inbound signature verification.",
    exemplar_tags: ["telnyx", "sms", "webhook", "compliance"],
  },
  {
    key: "email_delivery",
    label: "Email delivery resilience",
    objective:
      "Improve provider fallback handling, structured logging, bounce/failed-send signals, and deterministic retry behavior.",
    exemplar_tags: ["email", "delivery", "retry"],
  },
  {
    key: "queue_backpressure",
    label: "Queue backpressure and retries",
    objective:
      "Tune queue retry/backoff/idempotency behavior and add guardrails for poison messages and dead-letter loops.",
    exemplar_tags: ["queue", "retry", "dead_letter"],
  },
  {
    key: "auth_session",
    label: "Auth/session hardening",
    objective:
      "Standardize session handling, route protection, and token validation with minimal coupling and clear failure modes.",
    exemplar_tags: ["auth", "session", "token"],
  },
  {
    key: "observability",
    label: "Observability and audit trails",
    objective:
      "Add structured logs, per-flow metrics, and end-to-end event audit records for high-value actions.",
    exemplar_tags: ["observability", "logging", "metrics", "audit"],
  },
  {
    key: "api_contracts",
    label: "API contract validation",
    objective:
      "Tighten payload/schema validation and response contracts for critical API endpoints and worker task interfaces.",
    exemplar_tags: ["api", "schema", "validation"],
  },
  {
    key: "data_integrity",
    label: "Data integrity and migrations",
    objective:
      "Add integrity constraints, safe migration patterns, and deterministic state transitions for critical tables.",
    exemplar_tags: ["database", "migration", "integrity"],
  },
  {
    key: "desktop_packaging",
    label: "Desktop packaging and runtime hardening",
    objective:
      "Improve macOS app packaging/runtime boot sequence, startup diagnostics, and deterministic service health checks.",
    exemplar_tags: ["electron", "macos", "packaging"],
  },
  {
    key: "symbolic_qa_engine",
    label: "Symbol-aware QA engine",
    objective:
      "Build symbol-native QA flow: map runtime/UI failures to owning symbols, generate targeted checks, and run minimal deterministic repros before broad E2E.",
    exemplar_tags: ["qa", "symbol", "triage", "assertion", "retry"],
  },
  {
    key: "cdp_contract_probe",
    label: "CDP contract probes",
    objective:
      "Implement fast CDP-based probes for API contracts, console errors, failed network requests, and browser performance thresholds with strong reporting.",
    exemplar_tags: ["cdp", "network", "performance", "qa", "browser"],
  },
  {
    key: "visual_regression_fastlane",
    label: "Visual regression fastlane",
    objective:
      "Add lightweight visual regression checks with deterministic viewport baselines and low-noise diff thresholds.",
    exemplar_tags: ["visual", "regression", "qa", "snapshot", "browser"],
  },
];

const EXEMPLAR_LIBRARY = [
  { name: "autopay_ui", repo: "local/autopay_ui", url: "https://github.com/smanthey/autopay_ui", tags: ["stripe", "telnyx", "webhook", "sms", "checkout"] },
  { name: "CaptureInbound", repo: "local/CaptureInbound", url: "https://github.com/smanthey/CaptureInbound", tags: ["stripe", "email", "queue", "api"] },
  { name: "veritap_2026", repo: "local/veritap_2026", url: "https://github.com/smanthey/veritap", tags: ["auth", "webhook", "api", "logging"] },
  { name: "openclaw", repo: "local/claw-architect", url: "https://github.com/openclaw/openclaw", tags: ["queue", "pm2", "dispatcher", "observability"] },
  { name: "trigger.dev", repo: "", url: "https://github.com/triggerdotdev/trigger.dev", tags: ["queue", "workflow", "retry", "durable"] },
  { name: "medusajs", repo: "", url: "https://github.com/medusajs/medusa", tags: ["checkout", "payment", "api", "auth"] },
  { name: "supabase", repo: "", url: "https://github.com/supabase/supabase", tags: ["auth", "database", "api"] },
  { name: "cal.com", repo: "", url: "https://github.com/calcom/cal.com", tags: ["scheduling", "api", "webhook", "email"] },
  { name: "directus", repo: "", url: "https://github.com/directus/directus", tags: ["api", "schema", "auth", "observability"] },
  { name: "appsmith", repo: "", url: "https://github.com/appsmithorg/appsmith", tags: ["observability", "api", "auth"] },
  { name: "cypress", repo: "cypress-io/cypress", url: "https://github.com/cypress-io/cypress", tags: ["qa", "assertion", "retry", "browser"] },
  { name: "webdriverio", repo: "webdriverio/webdriverio", url: "https://github.com/webdriverio/webdriverio", tags: ["qa", "browser", "mobile", "retry"] },
  { name: "selenium", repo: "seleniumhq/selenium", url: "https://github.com/SeleniumHQ/selenium", tags: ["qa", "webdriver", "browser"] },
  { name: "puppeteer", repo: "puppeteer/puppeteer", url: "https://github.com/puppeteer/puppeteer", tags: ["browser", "cdp", "qa"] },
  { name: "testcafe", repo: "DevExpress/testcafe", url: "https://github.com/DevExpress/testcafe", tags: ["qa", "assertion", "browser"] },
  { name: "backstopjs", repo: "garris/BackstopJS", url: "https://github.com/garris/BackstopJS", tags: ["visual", "regression", "qa", "snapshot"] },
  { name: "k6-browser", repo: "grafana/k6", url: "https://github.com/grafana/k6", tags: ["performance", "browser", "qa", "cdp"] },
];

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function ensureStateTable() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS feature_rotation_state (
      repo_key TEXT PRIMARY KEY,
      next_feature_idx INTEGER NOT NULL DEFAULT 0,
      last_run_date DATE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function loadMissionRepos() {
  try {
    const mission = JSON.parse(fs.readFileSync(MISSION_PATH, "utf8"));
    return (mission.target_saas_repos || [])
      .map((r) => String(r || "").trim())
      .filter(Boolean)
      .slice(0, MAX_REPOS);
  } catch {
    return [];
  }
}

async function loadManagedRepos() {
  try {
    const { rows } = await pg.query(
      `SELECT DISTINCT local_path
         FROM managed_repos
        WHERE status = 'active'
          AND local_path IS NOT NULL
        ORDER BY local_path ASC
        LIMIT $1`,
      [MAX_REPOS]
    );
    return rows
      .map((r) => String(r.local_path || "").trim())
      .filter(Boolean)
      .map((lp) => {
        const bn = path.basename(lp);
        return bn.startsWith("local/") ? bn : `local/${bn}`;
      });
  } catch {
    return [];
  }
}

function uniq(arr) {
  return [...new Set(arr)];
}

function prioritizeRepos(repos) {
  const rank = new Map();
  PRIORITY_REPOS.forEach((k, i) => rank.set(k, i));
  return [...repos].sort((a, b) => {
    const ar = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return String(a).localeCompare(String(b));
  });
}

async function getRotationState(repoKey) {
  const { rows } = await pg.query(
    `SELECT repo_key, next_feature_idx, last_run_date
       FROM feature_rotation_state
      WHERE repo_key = $1`,
    [repoKey]
  );
  return rows[0] || null;
}

async function setRotationState(repoKey, nextFeatureIdx, runDate) {
  await pg.query(
    `INSERT INTO feature_rotation_state (repo_key, next_feature_idx, last_run_date, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (repo_key)
     DO UPDATE SET
       next_feature_idx = EXCLUDED.next_feature_idx,
       last_run_date = EXCLUDED.last_run_date,
       updated_at = NOW()`,
    [repoKey, nextFeatureIdx, runDate]
  );
}

function loadExemplarRepos() {
  try {
    const raw = fs.readFileSync(EXEMPLAR_REPOS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pickExemplars(feature, limit = 8) {
  const tags = new Set((feature.exemplar_tags || []).map((t) => String(t).toLowerCase()));
  const exemplarData = loadExemplarRepos();
  const out = [];

  if (exemplarData?.dashboard_chat?.length && [...tags].some((t) => ["chat", "dashboard", "ui", "observability", "api"].includes(t))) {
    for (const r of exemplarData.dashboard_chat.slice(0, 4)) {
      out.push({
        name: r.full_name,
        repo: r.full_name || null,
        url: r.html_url || `https://github.com/${r.full_name}`,
      });
    }
  }

  if (exemplarData?.by_feature_tags && typeof exemplarData.by_feature_tags === "object") {
    const scoreByKey = new Map();
    for (const [tag, list] of Object.entries(exemplarData.by_feature_tags)) {
      if (!tags.has(tag) || !Array.isArray(list)) continue;
      for (const e of list) {
        const key = e.repo || e.url;
        if (!key) continue;
        const entry = { name: e.name || e.repo || "repo", repo: e.repo || null, url: e.url || "" };
        scoreByKey.set(key, { entry, score: (scoreByKey.get(key)?.score || 0) + 1 });
      }
    }
    const scored = [...scoreByKey.values()].sort((a, b) => b.score - a.score);
    const seen = new Set(out.map((x) => x.repo || x.url));
    for (const { entry } of scored) {
      if (out.length >= limit) break;
      const key = entry.repo || entry.url;
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(entry);
      }
    }
  }

  if (out.length < limit) {
    const scored = EXEMPLAR_LIBRARY.map((e) => {
      const overlap = (e.tags || []).filter((t) => tags.has(String(t).toLowerCase())).length;
      return { e, score: overlap };
    })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const seen = new Set(out.map((x) => x.repo || x.url));
    for (const { e } of scored) {
      if (out.length >= limit) break;
      const key = e.repo || e.url;
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ name: e.name, repo: e.repo || null, url: e.url });
      }
    }
  }

  return out.slice(0, limit);
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, ACTIVE_TASK_STATUSES]
  );
  return rows.length > 0;
}

async function enqueueTask(type, payload) {
  return enqueueOnce({ type, payload, activeStatuses: ACTIVE_TASK_STATUSES });
}

function objectiveFor(repoKey, feature, exemplars, redditContext = []) {
  const exemplarLines = exemplars
    .map((x, i) => `${i + 1}. ${x.name}${x.repo ? ` (${x.repo})` : ""} - ${x.url}`)
    .join("\n");
  const redditBlock =
    redditContext.length > 0
      ? `\nReddit context (use for positioning/UX ideas):\n${redditContext.map((r) => `- ${r.title} (r/${r.subreddit}) ${r.permalink}`).join("\n")}\n`
      : "";
  return (
    `Daily feature rotation for ${repoKey}. Feature: ${feature.label}. ` +
    `${feature.objective}\n\n` +
    `Required process:\n` +
    `- Index repo with filesystem MCP + rg + local symbol-map scripts (no jcodemunch), then map entrypoints/dependencies with repo_mapper when available.\n` +
    `- Compare this feature to the top exemplar OSS repos below (at least 5; up to 10).\n` +
    `- Run benchmark scoring before and after implementation:\n` +
    `  npm run -s benchmark:score -- --repo ${repoKey} --feature ${feature.key} --source pre_merge\n` +
    `  npm run -s benchmark:gate -- --repo ${repoKey} --feature ${feature.key}\n` +
    `- Extract best patterns and produce implementation plan with concrete symbol/file targets.\n` +
    `- Implement 1-2 production-safe improvements for this feature in this repo.\n` +
    `- Add/update tests and smoke checks tied to changed symbols.\n` +
    `- Record what was learned in docs/notes for future lightweight micro-SaaS reuse.\n\n` +
    `Top exemplar repos:\n${exemplarLines}${redditBlock}`
  );
}

async function main() {
  await ensureStateTable();

  const today = new Date().toISOString().slice(0, 10);
  const missionRepos = loadMissionRepos();
  const managedRepos = await loadManagedRepos();
  const repos = prioritizeRepos(uniq([...missionRepos, ...managedRepos])).slice(0, MAX_REPOS);

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    run_date: today,
    repos_considered: repos.length,
    features_per_repo: FEATURES_PER_REPO,
    priority_repos: PRIORITY_REPOS,
    queued: [],
    skipped: [],
  };

  const exemplarData = loadExemplarRepos();
  const redditContext = Array.isArray(exemplarData?.reddit_context) ? exemplarData.reddit_context.slice(0, 5) : [];

  for (const repoKey of repos) {
    const state = await getRotationState(repoKey);
    const startIdx = Number(state?.next_feature_idx || 0) % FEATURE_CATALOG.length;
    const selections = [];
    for (let i = 0; i < FEATURES_PER_REPO; i += 1) {
      const idx = (startIdx + i) % FEATURE_CATALOG.length;
      selections.push(FEATURE_CATALOG[idx]);
    }

    let createdAny = false;
    for (const feature of selections) {
      const exemplars = pickExemplars(feature, 10);
      const isPriorityRepo = PRIORITY_REPOS.includes(repoKey);
      if (isPriorityRepo) {
        const closed = await enqueueClosedLoopChain({
          repo: repoKey,
          feature_key: feature.key,
          source: "daily_feature_rotation_closed_loop",
          objective: objectiveFor(repoKey, feature, exemplars, redditContext),
          run_date: today,
          quality_target: 92,
        });
        report.queued.push({
          repo: repoKey,
          feature: feature.key,
          mode: "closed_loop_chain",
          ...closed,
        });
        if (closed.created) createdAny = true;
        else report.skipped.push({ repo: repoKey, feature: feature.key, reason: closed.reason || "not_created" });
        continue;
      }

      const payload = {
        repo: repoKey,
        source: "daily_feature_rotation",
        feature_key: feature.key,
        feature_label: feature.label,
        benchmark_required: true,
        benchmark_gate: {
          repo: repoKey,
          feature_key: feature.key,
          command_score: `npm run -s benchmark:score -- --repo ${repoKey} --feature ${feature.key} --source pre_merge`,
          command_gate: `npm run -s benchmark:gate -- --repo ${repoKey} --feature ${feature.key}`,
        },
        run_date: today,
        objective: objectiveFor(repoKey, feature, exemplars, redditContext),
        exemplar_repos: exemplars,
        reddit_context: redditContext,
        force_implement: true,
        max_iterations: 2,
      };

      const queued = await enqueueTask("opencode_controller", payload);
      report.queued.push({
        repo: repoKey,
        feature: feature.key,
        ...queued,
      });
      if (queued.created) createdAny = true;
      else report.skipped.push({ repo: repoKey, feature: feature.key, reason: queued.reason });
    }

    if (createdAny) {
      const next = (startIdx + FEATURES_PER_REPO) % FEATURE_CATALOG.length;
      await setRotationState(repoKey, next, today);
    }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[daily-feature-rotation] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

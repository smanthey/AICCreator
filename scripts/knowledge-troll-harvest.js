#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const INDEX_DIR = path.join(process.env.HOME || os.homedir(), ".code-index");
const REPORT_PATH = path.join(ROOT, "reports", "knowledge-troll-harvest-latest.json");
const DOMAIN_EXEMPLARS_PATH = path.join(ROOT, "mcp", "domain-exemplars.json");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "PENDING"];

const REPO_LIMIT_PER_QUERY = Math.max(5, Math.min(20, Number(process.env.TROLL_REPO_LIMIT || "12")));
const PAPER_LIMIT_PER_QUERY = Math.max(3, Math.min(15, Number(process.env.TROLL_PAPER_LIMIT || "8")));
const MAX_INDEX_TASKS = Math.max(5, Math.min(40, Number(process.env.TROLL_MAX_INDEX_TASKS || "18")));

const DOMAIN_QUERIES = {
  stripe: {
    repo: [
      "stripe checkout webhook idempotency typescript",
      "stripe connect marketplace payments node",
    ],
    paper: [
      "payment fraud detection machine learning",
      "online payment retry optimization",
    ],
  },
  qa: {
    repo: [
      "browser automation cdp testing framework",
      "visual regression testing open source",
      "test flakiness reduction retries",
    ],
    paper: [
      "software test flakiness detection",
      "ui testing reliability",
    ],
  },
  queue: {
    repo: [
      "distributed job queue retry dead letter",
      "event driven workflow orchestration",
    ],
    paper: [
      "queueing systems reliability distributed systems",
      "workflow orchestration fault tolerance",
    ],
  },
  agent: {
    repo: [
      "llm agent framework memory planning",
      "autonomous software engineering agent",
      "multi agent orchestration code generation",
    ],
    paper: [
      "self correcting language models code generation",
      "planning and tool use language agents",
      "retrieval augmented code generation",
    ],
  },
  trading: {
    repo: [
      "algorithmic trading backtesting risk engine",
      "portfolio optimization open source",
    ],
    paper: [
      "algorithmic trading reinforcement learning",
      "risk management position sizing",
    ],
  },
};

const DOMAIN_REPO_FALLBACKS = {
  stripe: [
    "medusajs/medusa",
    "vendure-ecommerce/vendure",
    "saleor/saleor",
    "formbricks/formbricks",
  ],
  qa: [
    "microsoft/playwright",
    "cypress-io/cypress",
    "webdriverio/webdriverio",
    "SeleniumHQ/selenium",
    "puppeteer/puppeteer",
    "DevExpress/testcafe",
    "garris/BackstopJS",
    "grafana/k6",
  ],
  queue: [
    "triggerdotdev/trigger.dev",
    "temporalio/temporal",
    "bullmq/bullmq",
    "taskforcesh/bullmq",
    "apache/kafka",
  ],
  agent: [
    "langchain-ai/langchain",
    "microsoft/autogen",
    "crewAIInc/crewAI",
    "run-llama/llama_index",
    "OpenDevin/OpenDevin",
    "Significant-Gravitas/AutoGPT",
    "All-Hands-AI/OpenHands",
  ],
  trading: [
    "freqtrade/freqtrade",
    "quantopian/zipline",
    "mementum/backtrader",
    "kernc/backtesting.py",
    "ccxt/ccxt",
  ],
};

let _routingColsEnsured = false;

function safeJSONParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function daysSince(iso) {
  if (!iso) return 9999;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 9999;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

function repoScore(repo, domain) {
  const stars = Number(repo.stargazersCount || 0);
  const days = daysSince(repo.updatedAt);
  const recency = days <= 7 ? 30 : days <= 30 ? 22 : days <= 90 ? 12 : 4;
  const starScore = Math.min(40, Math.round(Math.log10(Math.max(1, stars + 1)) * 12));
  const hasDesc = repo.description ? 8 : 0;
  const notArchived = repo.isArchived ? -15 : 6;
  const notFork = repo.isFork ? -8 : 6;
  const domainBias = domain === "agent" || domain === "qa" ? 8 : 4;
  return Math.max(0, Math.min(100, recency + starScore + hasDesc + notArchived + notFork + domainBias));
}

function paperScore(paper, domain) {
  const days = daysSince(paper.publishedAt);
  const recency = days <= 30 ? 45 : days <= 180 ? 30 : days <= 365 ? 20 : 8;
  const titleScore = paper.title ? Math.min(20, Math.round(paper.title.length / 12)) : 0;
  const absScore = paper.summary ? 18 : 0;
  const domainBias = domain === "agent" || domain === "qa" ? 12 : 7;
  return Math.max(0, Math.min(100, recency + titleScore + absScore + domainBias));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isRepoIndexed(repoKey) {
  const fp = path.join(INDEX_DIR, `${String(repoKey).replace(/\//g, "-")}.json`);
  try {
    fs.accessSync(fp, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function ghSearchRepos(query, limit = REPO_LIMIT_PER_QUERY) {
  const args = [
    "search",
    "repos",
    query,
    "--limit",
    String(limit),
    "--json",
    "nameWithOwner,url,description,stargazersCount,updatedAt,isArchived,isFork,primaryLanguage",
  ];
  const res = spawnSync("gh", args, { encoding: "utf8", cwd: ROOT, env: process.env });
  if (res.status !== 0 || !res.stdout) return [];
  const parsed = safeJSONParse(res.stdout, []);
  return Array.isArray(parsed) ? parsed : [];
}

function fallbackRepoRows(domain) {
  const repos = DOMAIN_REPO_FALLBACKS[domain] || [];
  return repos.map((nameWithOwner) => ({
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    description: `Fallback curated exemplar for ${domain}`,
    stargazersCount: 0,
    updatedAt: null,
    isArchived: false,
    isFork: false,
    primaryLanguage: null,
  }));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "claw-architect/knowledge-troll" } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function extractTag(entry, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = entry.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function parseArxiv(xml) {
  const entries = xml.split("<entry>").slice(1).map((x) => `<entry>${x}`);
  return entries.map((entry) => {
    const id = extractTag(entry, "id");
    const title = extractTag(entry, "title");
    const summary = extractTag(entry, "summary");
    const publishedAt = extractTag(entry, "published");
    const url = id || "";
    const key = id ? id.split("/").pop() : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64);
    return {
      sourceKey: `paper:arxiv:${key}`,
      id: key,
      title,
      summary,
      publishedAt,
      url,
    };
  }).filter((x) => x.title);
}

async function arxivSearch(query, limit = PAPER_LIMIT_PER_QUERY) {
  const q = encodeURIComponent(query);
  const url = `https://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  try {
    const xml = await fetchText(url);
    return parseArxiv(xml);
  } catch {
    return [];
  }
}

async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      source_key TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('repo','paper')),
      domain TEXT NOT NULL,
      title TEXT,
      url TEXT,
      summary TEXT,
      source_updated_at TIMESTAMPTZ,
      score INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      indexed BOOLEAN NOT NULL DEFAULT FALSE,
      last_index_attempt_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS pattern_insights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      feature_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      insight TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 0,
      source_keys TEXT[] NOT NULL DEFAULT '{}',
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
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

async function upsertKnowledgeSource(row) {
  await pg.query(
    `INSERT INTO knowledge_sources
      (source_key, source_type, domain, title, url, summary, source_updated_at, score, metadata, indexed, last_index_attempt_at, status, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, 'active', NOW())
     ON CONFLICT (source_key)
     DO UPDATE SET
       domain = EXCLUDED.domain,
       title = EXCLUDED.title,
       url = EXCLUDED.url,
       summary = EXCLUDED.summary,
       source_updated_at = EXCLUDED.source_updated_at,
       score = EXCLUDED.score,
       metadata = EXCLUDED.metadata,
       indexed = EXCLUDED.indexed,
       last_index_attempt_at = EXCLUDED.last_index_attempt_at,
       status = 'active',
       updated_at = NOW()`,
    [
      row.source_key,
      row.source_type,
      row.domain,
      row.title || null,
      row.url || null,
      row.summary || null,
      row.source_updated_at || null,
      row.score || 0,
      JSON.stringify(row.metadata || {}),
      !!row.indexed,
      row.last_index_attempt_at || null,
    ]
  );
}

function readDomainExemplars() {
  try {
    return safeJSONParse(fs.readFileSync(DOMAIN_EXEMPLARS_PATH, "utf8"), {});
  } catch {
    return {};
  }
}

async function main() {
  await ensureSchema();

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    repos_discovered: 0,
    papers_discovered: 0,
    domains: {},
    queued_index_subagent_tasks: [],
    queued_pattern_subagent_tasks: [],
  };

  const repoCandidates = [];
  const paperCandidates = [];

  for (const [domain, q] of Object.entries(DOMAIN_QUERIES)) {
    const domainRepoRows = [];
    const domainPaperRows = [];

    for (const repoQ of q.repo || []) {
      const repos = ghSearchRepos(repoQ, REPO_LIMIT_PER_QUERY);
      for (const r of repos) {
        if (!r?.nameWithOwner) continue;
        const repoKey = String(r.nameWithOwner);
        const sourceKey = `repo:${repoKey}`;
        const score = repoScore(r, domain);
        const indexed = isRepoIndexed(repoKey);
        const row = {
          source_key: sourceKey,
          source_type: "repo",
          domain,
          title: repoKey,
          url: r.url || `https://github.com/${repoKey}`,
          summary: r.description || "",
          source_updated_at: r.updatedAt || null,
          score,
          indexed,
          metadata: {
            stars: Number(r.stargazersCount || 0),
            language: r.primaryLanguage?.name || null,
            archived: !!r.isArchived,
            fork: !!r.isFork,
            query: repoQ,
          },
          last_index_attempt_at: indexed ? new Date().toISOString() : null,
        };
        await upsertKnowledgeSource(row);
        repoCandidates.push(row);
        domainRepoRows.push(row);
      }
    }

    if (domainRepoRows.length === 0) {
      const repos = fallbackRepoRows(domain);
      for (const r of repos) {
        const repoKey = String(r.nameWithOwner);
        const sourceKey = `repo:${repoKey}`;
        const score = 52;
        const indexed = isRepoIndexed(repoKey);
        const row = {
          source_key: sourceKey,
          source_type: "repo",
          domain,
          title: repoKey,
          url: r.url || `https://github.com/${repoKey}`,
          summary: r.description || "",
          source_updated_at: null,
          score,
          indexed,
          metadata: {
            stars: 0,
            language: null,
            archived: false,
            fork: false,
            query: "fallback",
          },
          last_index_attempt_at: indexed ? new Date().toISOString() : null,
        };
        await upsertKnowledgeSource(row);
        repoCandidates.push(row);
        domainRepoRows.push(row);
      }
    }

    for (const paperQ of q.paper || []) {
      const papers = await arxivSearch(paperQ, PAPER_LIMIT_PER_QUERY);
      for (const p of papers) {
        const score = paperScore(p, domain);
        const row = {
          source_key: p.sourceKey,
          source_type: "paper",
          domain,
          title: p.title,
          url: p.url,
          summary: p.summary,
          source_updated_at: p.publishedAt || null,
          score,
          indexed: false,
          metadata: { query: paperQ, provider: "arxiv", published_at: p.publishedAt || null },
          last_index_attempt_at: null,
        };
        await upsertKnowledgeSource(row);
        paperCandidates.push(row);
        domainPaperRows.push(row);
      }
    }

    report.domains[domain] = {
      repos: domainRepoRows.length,
      papers: domainPaperRows.length,
      top_repo_candidates: domainRepoRows
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => ({ key: x.source_key, score: x.score, url: x.url })),
      top_paper_candidates: domainPaperRows
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => ({ key: x.source_key, score: x.score, url: x.url })),
    };
  }

  report.repos_discovered = repoCandidates.length;
  report.papers_discovered = paperCandidates.length;

  const uniqueRepo = new Map();
  for (const r of repoCandidates) {
    if (!uniqueRepo.has(r.source_key) || (uniqueRepo.get(r.source_key).score < r.score)) {
      uniqueRepo.set(r.source_key, r);
    }
  }
  const repoRanked = [...uniqueRepo.values()]
    .filter((r) => !r.indexed && r.score >= 45 && !r.metadata.archived)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INDEX_TASKS);

  const existingExemplars = readDomainExemplars();

  for (const rr of repoRanked) {
    const repoName = rr.source_key.replace(/^repo:/, "");
    const payload = {
      repo: "local/claw-architect",
      source: "knowledge_troll_index",
      feature_key: "index_new_exemplar_repo",
      objective:
        `Subagent task: index repo ${repoName} via filesystem MCP + rg + local symbol-map scripts (no jcodemunch), then run repo_mapper summary when available.\n` +
        `If high-quality symbols are found, update mcp/domain-exemplars.json and config/domain-exemplars.json for domain "${rr.domain}".\n` +
        `Repo URL: ${rr.url}\nScore: ${rr.score}`,
      max_iterations: 1,
      quality_target: 90,
      auto_iterate: true,
      force_implement: true,
      evidence: {
        source_key: rr.source_key,
        domain: rr.domain,
        stars: rr.metadata.stars,
        existing_domain_exemplar_count: Array.isArray(existingExemplars?.[rr.domain]?.exemplars)
          ? existingExemplars[rr.domain].exemplars.length
          : 0,
      },
    };
    const queued = await enqueueTask("opencode_controller", payload);
    report.queued_index_subagent_tasks.push({
      source_key: rr.source_key,
      repo: repoName,
      domain: rr.domain,
      score: rr.score,
      ...queued,
    });
    if (queued.created) {
      await pg.query(
        `UPDATE knowledge_sources
            SET last_index_attempt_at = NOW()
          WHERE source_key = $1`,
        [rr.source_key]
      ).catch(() => {});
    }
  }

  const paperRanked = [...new Map(paperCandidates.map((p) => [p.source_key, p])).values()]
    .filter((p) => p.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  for (const p of paperRanked) {
    const payload = {
      repo: "local/claw-architect",
      source: "knowledge_troll_paper_synthesis",
      feature_key: "paper_to_pattern",
      objective:
        `Subagent task: distill this paper into practical coding patterns for ${p.domain}.\n` +
        `Paper: ${p.title}\nURL: ${p.url}\n` +
        `Required output: actionable pattern notes + symbol targets + closed-loop improvement tasks.`,
      max_iterations: 1,
      quality_target: 88,
      auto_iterate: true,
      force_implement: true,
      evidence: {
        source_key: p.source_key,
        domain: p.domain,
        title: p.title,
      },
    };
    const queued = await enqueueTask("opencode_controller", payload);
    report.queued_pattern_subagent_tasks.push({
      source_key: p.source_key,
      domain: p.domain,
      score: p.score,
      ...queued,
    });
  }

  ensureDir(path.dirname(REPORT_PATH));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[knowledge-troll-harvest] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

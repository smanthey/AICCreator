#!/usr/bin/env node
"use strict";

require("dotenv").config({ override: true });

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { createToolBudget } = require("../control/mcp-tool-budget");

let agentMemorySql = null;
try {
  agentMemorySql = require("../control/agent-memory-sql");
} catch {
  agentMemorySql = null;
}

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");

function getPool() {
  return new Pool({
    host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
    port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
    user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
    password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
    max: 6,
    connectionTimeoutMillis: 5000,
  });
}

function stableId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function sha(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

function sourceTrust(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("official") || s.includes("docs") || s.includes("verified")) return 1.0;
  if (s.includes("repo") || s.includes("github")) return 0.85;
  if (s.includes("internal")) return 0.8;
  if (s.includes("reddit")) return 0.55;
  return 0.65;
}

function recencyScore(ts) {
  const t = new Date(ts || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return 0;
  const ageHours = (Date.now() - t) / 3600000;
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.8;
  if (ageHours <= 7 * 24) return 0.6;
  if (ageHours <= 30 * 24) return 0.35;
  return 0.15;
}

function extractEntities(text = "") {
  const out = new Set();
  const t = String(text || "");

  const repo = t.match(/\b[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\b/g) || [];
  for (const x of repo) out.add(`repo:${x.toLowerCase()}`);

  const urlHost = (t.match(/https?:\/\/([^\s/]+)/g) || [])
    .map((u) => u.replace(/^https?:\/\//, "").toLowerCase());
  for (const h of urlHost) out.add(`host:${h}`);

  const caps = t.match(/\b[A-Z][a-zA-Z0-9_-]{2,}\b/g) || [];
  for (const c of caps.slice(0, 20)) out.add(`term:${c.toLowerCase()}`);

  return [...out];
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_short_cache (
      cache_key TEXT PRIMARY KEY,
      cache_value JSONB NOT NULL,
      source TEXT,
      trust_score NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accessed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_episodic_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_context TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      tags TEXT[] NOT NULL DEFAULT '{}'::text[],
      source TEXT,
      trust_score NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      embedding JSONB,
      embedding_model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mcp_entity_nodes (
      id BIGSERIAL PRIMARY KEY,
      entity_key TEXT UNIQUE NOT NULL,
      entity_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mcp_entity_edges (
      id BIGSERIAL PRIMARY KEY,
      src_node_id BIGINT NOT NULL REFERENCES mcp_entity_nodes(id) ON DELETE CASCADE,
      dst_node_id BIGINT NOT NULL REFERENCES mcp_entity_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      weight NUMERIC(6,3) NOT NULL DEFAULT 1,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (src_node_id, dst_node_id, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_short_cache_exp ON mcp_short_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_epi_agent_created ON mcp_episodic_memory(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mcp_epi_tags ON mcp_episodic_memory USING GIN(tags);
    CREATE INDEX IF NOT EXISTS idx_mcp_entity_edges_src ON mcp_entity_edges(src_node_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_entity_edges_dst ON mcp_entity_edges(dst_node_id);
  `);
}

async function cacheSet(pool, key, value, opts = {}) {
  const ttlHours = Math.max(1, Number(opts.ttlHours || process.env.MCP_CACHE_TTL_HOURS || 6));
  const source = String(opts.source || "internal");
  const trust = Number.isFinite(opts.trust) ? Number(opts.trust) : sourceTrust(source);
  const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();

  await pool.query(
    `INSERT INTO mcp_short_cache(cache_key, cache_value, source, trust_score, expires_at)
     VALUES($1,$2::jsonb,$3,$4,$5)
     ON CONFLICT(cache_key) DO UPDATE
     SET cache_value=EXCLUDED.cache_value, source=EXCLUDED.source, trust_score=EXCLUDED.trust_score, expires_at=EXCLUDED.expires_at, accessed_at=NOW()`,
    [sha(key), JSON.stringify(value || {}), source, trust, expiresAt]
  );

  return { key_hash: sha(key), expires_at: expiresAt };
}

async function cacheGet(pool, key) {
  const keyHash = sha(key);
  const { rows } = await pool.query(
    `SELECT cache_value, source, trust_score, expires_at
     FROM mcp_short_cache
     WHERE cache_key=$1 AND expires_at > NOW()`,
    [keyHash]
  );
  if (!rows.length) return null;
  await pool.query(`UPDATE mcp_short_cache SET accessed_at=NOW() WHERE cache_key=$1`, [keyHash]);
  return rows[0];
}

async function rememberEpisode(pool, input = {}) {
  const id = stableId("epi");
  const summary = String(input.summary || "").trim();
  if (!summary) throw new Error("summary is required");

  let embedding = null;
  let embeddingModel = null;
  if (agentMemorySql && typeof agentMemorySql.generateEmbedding === "function") {
    const emb = await agentMemorySql.generateEmbedding(summary);
    embedding = emb?.vector || null;
    embeddingModel = emb?.model || null;
  }

  await pool.query(
    `INSERT INTO mcp_episodic_memory(
      id, agent_id, summary, raw_context, metadata, tags, source, trust_score, embedding, embedding_model
    ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10)`,
    [
      id,
      String(input.agent_id || "architect"),
      summary,
      String(input.raw_context || ""),
      JSON.stringify(input.metadata || {}),
      Array.isArray(input.tags) ? input.tags : [],
      String(input.source || "internal"),
      Number.isFinite(input.trust_score) ? Number(input.trust_score) : sourceTrust(input.source),
      embedding ? JSON.stringify(embedding) : null,
      embeddingModel,
    ]
  );

  return { id };
}

async function upsertEntityGraph(pool, text, evidence = {}) {
  const entities = extractEntities(text);
  if (entities.length < 2) return { entities, edges_upserted: 0 };

  const nodeIds = [];
  for (const e of entities) {
    const [entityType] = e.split(":");
    const up = await pool.query(
      `INSERT INTO mcp_entity_nodes(entity_key, entity_type, metadata, last_seen_at)
       VALUES($1,$2,$3::jsonb,NOW())
       ON CONFLICT(entity_key) DO UPDATE SET last_seen_at=NOW()
       RETURNING id`,
      [e, entityType || "term", JSON.stringify({})]
    );
    nodeIds.push(up.rows[0].id);
  }

  let edges = 0;
  for (let i = 0; i < nodeIds.length; i += 1) {
    for (let j = i + 1; j < nodeIds.length; j += 1) {
      await pool.query(
        `INSERT INTO mcp_entity_edges(src_node_id, dst_node_id, relation, weight, evidence)
         VALUES($1,$2,'co_occurs',1,$3::jsonb)
         ON CONFLICT(src_node_id,dst_node_id,relation)
         DO UPDATE SET weight = mcp_entity_edges.weight + 1, evidence=$3::jsonb, updated_at=NOW()`,
        [nodeIds[i], nodeIds[j], JSON.stringify(evidence || {})]
      );
      edges += 1;
    }
  }

  return { entities, edges_upserted: edges };
}

async function retrieve(pool, input = {}, budget) {
  const q = String(input.query || "").trim();
  if (!q) return [];
  const agentId = String(input.agent_id || "architect").trim();
  const limit = Math.max(1, Math.min(50, Number(input.limit || 12)));
  const lookbackDays = Math.max(1, Math.min(180, Number(input.lookback_days || 30)));
  const minTrust = Number.isFinite(Number(input.min_trust)) ? Number(input.min_trust) : 0.3;

  const wide = await pool.query(
    `SELECT id, agent_id, summary, raw_context, source, trust_score, tags, created_at,
            GREATEST(
              ts_rank(to_tsvector('english', summary), plainto_tsquery('english', $1)),
              ts_rank(to_tsvector('english', COALESCE(raw_context,'')), plainto_tsquery('english', $1))
            ) AS recall_rank
     FROM mcp_episodic_memory
     WHERE ($2 = '' OR agent_id = $2)
       AND trust_score >= $3
       AND created_at >= NOW() - ($4 || ' days')::interval
       AND (
         to_tsvector('english', summary) @@ plainto_tsquery('english', $1)
         OR to_tsvector('english', COALESCE(raw_context,'')) @@ plainto_tsquery('english', $1)
       )
     ORDER BY recall_rank DESC, created_at DESC
     LIMIT $5`,
    [q, agentId, minTrust, String(lookbackDays), Math.max(limit * 3, 20)]
  );
  budget.record("episodic_wide_recall", JSON.stringify(wide.rows));

  let longTerm = [];
  if (agentMemorySql && typeof agentMemorySql.searchMemories === "function") {
    try {
      longTerm = await agentMemorySql.searchMemories({
        agent_id: agentId,
        query: q,
        limit: Math.max(limit * 2, 20),
        min_importance: 0.4,
        lookback_days: lookbackDays,
        min_similarity: 0.45,
      });
      budget.record("long_term_vector_recall", JSON.stringify(longTerm));
    } catch {
      longTerm = [];
    }
  }

  const entities = extractEntities(q);
  let graphRows = [];
  if (entities.length) {
    const g = await pool.query(
      `SELECT n.entity_key, e.relation, e.weight, o.entity_key AS related
       FROM mcp_entity_nodes n
       JOIN mcp_entity_edges e ON e.src_node_id = n.id
       JOIN mcp_entity_nodes o ON o.id = e.dst_node_id
       WHERE n.entity_key = ANY($1::text[])
       ORDER BY e.weight DESC
       LIMIT 40`,
      [entities]
    );
    graphRows = g.rows;
    budget.record("graph_expansion", JSON.stringify(graphRows));
  }

  const combined = [];
  for (const r of wide.rows) {
    combined.push({
      source_type: "episodic",
      id: r.id,
      text: r.summary,
      created_at: r.created_at,
      source: r.source,
      trust_score: Number(r.trust_score || 0),
      recall_rank: Number(r.recall_rank || 0),
    });
  }
  for (const r of longTerm) {
    combined.push({
      source_type: "long_term",
      id: r.id,
      text: r.content,
      created_at: r.created_at,
      source: r.source || "agent_memory",
      trust_score: 0.75,
      recall_rank: Number(r.similarity_score || 0),
      importance_score: Number(r.importance_score || 0.5),
    });
  }

  const reranked = combined
    .map((r) => {
      const sTrust = sourceTrust(r.source);
      const recency = recencyScore(r.created_at);
      const importance = Number.isFinite(r.importance_score) ? r.importance_score : 0.5;
      const score =
        (r.recall_rank * 0.45) +
        (recency * 0.2) +
        (Math.max(0, Math.min(1, r.trust_score)) * 0.2) +
        (sTrust * 0.1) +
        (importance * 0.05);
      return { ...r, rerank_score: Number(score.toFixed(6)) };
    })
    .sort((a, b) => b.rerank_score - a.rerank_score)
    .slice(0, limit);

  return {
    results: reranked,
    graph_context: graphRows,
    query_entities: entities,
  };
}

async function consolidateNightly(pool, input = {}) {
  const days = Math.max(1, Math.min(90, Number(input.days || 1)));
  const perAgentLimit = Math.max(10, Math.min(500, Number(input.per_agent_limit || 120)));

  const epi = await pool.query(
    `SELECT agent_id, summary, source, trust_score, tags, created_at
     FROM mcp_episodic_memory
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     ORDER BY agent_id, created_at DESC
     LIMIT $2`,
    [String(days), perAgentLimit * 20]
  );

  const byAgent = new Map();
  for (const row of epi.rows) {
    const key = String(row.agent_id || "architect");
    if (!byAgent.has(key)) byAgent.set(key, []);
    const list = byAgent.get(key);
    if (list.length < perAgentLimit) list.push(row);
  }

  const consolidated = [];
  for (const [agentId, items] of byAgent.entries()) {
    const top = items.slice(0, 20).map((x, i) => `- ${i + 1}. ${x.summary}`);
    const text = `Nightly consolidated memory for ${agentId} (${new Date().toISOString()}):\n${top.join("\n")}`;

    if (agentMemorySql && typeof agentMemorySql.storeMemory === "function") {
      try {
        await agentMemorySql.storeMemory({
          agent_id: agentId,
          content: text,
          content_type: "summary",
          source: "mcp_consolidation",
          importance_score: 0.75,
          tags: ["mcp", "consolidated", "nightly"],
          metadata: { consolidated_count: items.length, window_days: days },
        });
      } catch {
        // best-effort
      }
    }

    for (const x of items.slice(0, 10)) {
      await upsertEntityGraph(pool, x.summary, {
        source: x.source || "episodic",
        trust_score: x.trust_score,
        created_at: x.created_at,
      });
    }

    consolidated.push({ agent_id: agentId, episodes: items.length });
  }

  return { consolidated };
}

function writeReport(name, payload) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[.:]/g, "-");
  const report = path.join(REPORT_DIR, `${ts}-${name}.json`);
  const latest = path.join(REPORT_DIR, `${name}-latest.json`);
  fs.writeFileSync(report, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2));
  return { report, latest };
}

async function main() {
  const [cmd = "retrieve", ...rest] = process.argv.slice(2);
  const budget = createToolBudget({});
  const pool = getPool();

  try {
    await ensureSchema(pool);

    let out;
    if (cmd === "cache:set") {
      const [key = "", json = "{}", ttlHours = "6"] = rest;
      out = await cacheSet(pool, key, JSON.parse(json), { ttlHours: Number(ttlHours), source: "cli" });
    } else if (cmd === "cache:get") {
      const [key = ""] = rest;
      out = await cacheGet(pool, key);
    } else if (cmd === "episode:add") {
      const [agentId = "architect", summary = "", source = "internal"] = rest;
      out = await rememberEpisode(pool, { agent_id: agentId, summary, source, tags: ["manual"] });
    } else if (cmd === "consolidate") {
      const days = Number(rest[0] || process.env.MCP_CONSOLIDATE_DAYS || 1);
      out = await consolidateNightly(pool, { days });
    } else {
      const [query = "", agentId = "architect", limit = "12"] = rest;
      out = await retrieve(pool, { query, agent_id: agentId, limit: Number(limit) }, budget);
    }

    const payload = {
      ok: true,
      command: cmd,
      output: out,
      budget: budget.snapshot(),
      generated_at: new Date().toISOString(),
    };
    const paths = writeReport("mcp-memory-accelerator", payload);
    console.log(JSON.stringify({ ...payload, report: paths }, null, 2));
  } catch (err) {
    const payload = {
      ok: false,
      command: cmd,
      error: err?.message || String(err),
      budget: budget.snapshot(),
      generated_at: new Date().toISOString(),
    };
    const paths = writeReport("mcp-memory-accelerator", payload);
    console.log(JSON.stringify({ ...payload, report: paths }, null, 2));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ensureSchema,
  cacheSet,
  cacheGet,
  rememberEpisode,
  retrieve,
  consolidateNightly,
};

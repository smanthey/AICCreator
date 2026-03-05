#!/usr/bin/env node
"use strict";

/**
 * agent-memory-sql.js
 * 
 * SQL-based agent memory system with vector search capabilities.
 * Complements the file-based memory system in agent-memory.js.
 * 
 * Features:
 * - Persistent storage in PostgreSQL
 * - Vector embeddings for semantic search
 * - Full-text search
 * - Memory relationships and linking
 * - Automatic importance scoring
 */

require("dotenv").config({ override: true });

const { Pool } = require("pg");

// Database connection
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
      port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
      user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
      password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
      database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
      max: 5,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

// ─── Ensure Schema ────────────────────────────────────────────────────────────

// Check if pgvector is available
let pgvectorAvailable = false;

async function checkPgvectorAvailability() {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'vector'
      ) as available;
    `);
    pgvectorAvailable = result.rows[0]?.available || false;
    return pgvectorAvailable;
  } catch {
    pgvectorAvailable = false;
    return false;
  }
}

async function ensureSchema() {
  const pool = getPool();
  try {
    // Check pgvector availability first
    await checkPgvectorAvailability();
    
    // Run migration if needed
    const migrationPath = require("path").join(__dirname, "..", "migrations", "074_agent_memory_sql.sql");
    const fs = require("fs");
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, "utf8");
      await pool.query(sql);
    }
    
    // Re-check pgvector after migration
    await checkPgvectorAvailability();
    
    if (!pgvectorAvailable) {
      console.log("[agent-memory-sql] pgvector not available, using JSONB fallback for embeddings");
    }
  } catch (err) {
    // If migration fails due to pgvector, try to create tables without it
    if (err.message.includes("vector") || err.message.includes("extension")) {
      console.warn("[agent-memory-sql] pgvector not available, creating schema without vector support");
      await createSchemaWithoutVector();
    } else {
      console.error("[agent-memory-sql] Schema ensure failed:", err.message);
      throw err;
    }
  }
}

async function createSchemaWithoutVector() {
  const pool = getPool();
  
  // Check if table exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'agent_memory'
    );
  `);
  
  if (!tableCheck.rows[0].exists) {
    await pool.query(`
      CREATE TABLE agent_memory (
        id UUID PRIMARY KEY,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'learned',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        tags TEXT[] NOT NULL DEFAULT '{}'::text[],
        embedding JSONB,
        embedding_model TEXT,
        task_id UUID,
        plan_id UUID,
        run_id TEXT,
        source TEXT DEFAULT 'agent',
        importance_score NUMERIC(3,2) DEFAULT 0.5,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        accessed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ
      );
      
      CREATE INDEX idx_agent_memory_agent_created 
        ON agent_memory(agent_id, created_at DESC);
      
      CREATE INDEX idx_agent_memory_embedding_jsonb 
        ON agent_memory USING GIN (embedding)
        WHERE embedding IS NOT NULL;
      
      CREATE INDEX idx_agent_memory_content_fts 
        ON agent_memory USING GIN (to_tsvector('english', content));
    `);
  }
}

// ─── Generate Embedding ────────────────────────────────────────────────────────

async function generateEmbedding(text, model = null) {
  const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const EMBEDDING_MODEL = model || process.env.AGENT_MEMORY_EMBEDDING_MODEL || "mxbai-embed-large";
  
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }
    
    const data = await response.json();
    const embedding = data.embedding || (data.embeddings && data.embeddings[0]);
    
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Invalid embedding response");
    }
    
    return {
      vector: embedding,
      model: EMBEDDING_MODEL,
      dimensions: embedding.length,
    };
  } catch (err) {
    console.warn("[agent-memory-sql] Embedding generation failed:", err.message);
    return null;
  }
}

// ─── Store Memory ──────────────────────────────────────────────────────────────

async function storeMemory({
  agent_id,
  content,
  content_type = "learned",
  metadata = {},
  tags = [],
  embedding = null,
  task_id = null,
  plan_id = null,
  run_id = null,
  source = "agent",
  importance_score = null,
  verified = false,
  expires_at = null,
}) {
  await ensureSchema();
  const pool = getPool();
  
  // Generate embedding if not provided
  let embeddingData = embedding;
  if (!embeddingData && content) {
    embeddingData = await generateEmbedding(content);
  }
  
  // Auto-calculate importance if not provided
  if (importance_score === null) {
    // Higher importance for verified, feedback, blockers
    if (verified) importance_score = 0.9;
    else if (content_type === "feedback" || content_type === "blocker") importance_score = 0.8;
    else if (content_type === "strategy" || content_type === "insight") importance_score = 0.7;
    else importance_score = 0.5;
  }
  
  await checkPgvectorAvailability();
  
  try {
    // Store embedding as JSONB (always) and optionally as vector (if pgvector available)
    const embeddingJsonb = embeddingData?.vector ? JSON.stringify(embeddingData.vector) : null;
    let embeddingVectorParam = null;
    
    if (pgvectorAvailable && embeddingData?.vector) {
      embeddingVectorParam = `[${embeddingData.vector.join(",")}]`;
    }
    
    if (pgvectorAvailable && embeddingVectorParam) {
      // Use both JSONB and vector columns if available
      const result = await pool.query(`
        INSERT INTO agent_memory (
          agent_id, content, content_type, metadata, tags,
          embedding, embedding_vector, embedding_model,
          task_id, plan_id, run_id, source,
          importance_score, verified, expires_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::vector, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id, created_at
      `, [
        agent_id,
        content,
        content_type,
        JSON.stringify(metadata),
        tags,
        embeddingJsonb,
        embeddingVectorParam,
        embeddingData?.model || null,
        task_id,
        plan_id,
        run_id,
        source,
        importance_score,
        verified,
        expires_at,
      ]);
      return {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
      };
    } else {
      // Use JSONB only
      const result = await pool.query(`
        INSERT INTO agent_memory (
          agent_id, content, content_type, metadata, tags,
          embedding, embedding_model,
          task_id, plan_id, run_id, source,
          importance_score, verified, expires_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id, created_at
      `, [
        agent_id,
        content,
        content_type,
        JSON.stringify(metadata),
        tags,
        embeddingJsonb,
        embeddingData?.model || null,
        task_id,
        plan_id,
        run_id,
        source,
        importance_score,
        verified,
        expires_at,
      ]);
      return {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
      };
    }
    
    return {
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
    };
  } catch (err) {
    console.error("[agent-memory-sql] Store failed:", err.message);
    throw err;
  }
}

// ─── Search Memories ───────────────────────────────────────────────────────────

async function searchMemories({
  agent_id,
  query = null,
  query_embedding = null,
  content_type = null,
  tags = null,
  limit = 10,
  min_importance = 0.0,
  min_similarity = 0.7,
  lookback_days = null,
}) {
  await ensureSchema();
  const pool = getPool();
  
  // Generate query embedding if text query provided
  if (query && !query_embedding) {
    const embeddingData = await generateEmbedding(query);
    if (embeddingData) {
      query_embedding = embeddingData.vector;
    }
  }
  
  await checkPgvectorAvailability();
  
  // Build query with vector similarity if embedding available and pgvector is installed
  let sql = `
    SELECT 
      id, agent_id, content, content_type, metadata, tags,
      importance_score, verified, created_at, updated_at,
      CASE
  `;
  
  if (pgvectorAvailable && query_embedding) {
    sql += `
        WHEN $1::vector IS NOT NULL AND embedding_vector IS NOT NULL
        THEN 1 - (embedding_vector <=> $1::vector)
        WHEN $1::vector IS NOT NULL AND embedding IS NOT NULL
        THEN 0.5  -- Fallback: lower score for JSONB embeddings
        ELSE 0.0
    `;
  } else {
    // Use simplified similarity if pgvector not available
    sql += `
        WHEN $1::jsonb IS NOT NULL AND embedding IS NOT NULL
        THEN 0.5  -- Simplified: assume some similarity if both have embeddings
        ELSE 0.0
    `;
  }
  
  sql += `
      END as similarity_score
    FROM agent_memory
    WHERE agent_id = $2
  `;
  
  const params = [];
  if (pgvectorAvailable && query_embedding) {
    params.push(`[${query_embedding.join(",")}]`);
  } else if (query_embedding) {
    params.push(JSON.stringify(query_embedding));
  } else {
    params.push(null);
  }
  params.push(agent_id);
  let paramIndex = 3;
  
  if (content_type) {
    sql += ` AND content_type = $${paramIndex}`;
    params.push(content_type);
    paramIndex++;
  }
  
  if (tags && tags.length > 0) {
    sql += ` AND tags && $${paramIndex}::text[]`;
    params.push(tags);
    paramIndex++;
  }
  
  if (min_importance > 0) {
    sql += ` AND importance_score >= $${paramIndex}`;
    params.push(min_importance);
    paramIndex++;
  }
  
  if (lookback_days) {
    sql += ` AND created_at >= NOW() - INTERVAL '${lookback_days} days'`;
  }
  
  // Order by similarity if available, else by importance and recency
  if (query_embedding) {
    if (pgvectorAvailable) {
      sql += ` AND (embedding_vector IS NOT NULL OR embedding IS NOT NULL)
        AND similarity_score >= $${paramIndex}`;
    } else {
      sql += ` AND embedding IS NOT NULL
        AND similarity_score >= $${paramIndex}`;
    }
    params.push(min_similarity);
    paramIndex++;
    sql += ` ORDER BY similarity_score DESC, importance_score DESC, created_at DESC`;
  } else {
    sql += ` ORDER BY importance_score DESC, created_at DESC`;
  }
  
  sql += ` LIMIT $${paramIndex}`;
  params.push(limit);
  
  try {
    const result = await pool.query(sql, params);
    return result.rows.map(row => ({
      ...row,
      similarity_score: row.similarity_score ? parseFloat(row.similarity_score) : null,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    }));
  } catch (err) {
    console.error("[agent-memory-sql] Search failed:", err.message);
    throw err;
  }
}

// ─── Full-Text Search ─────────────────────────────────────────────────────────

async function fullTextSearch({
  agent_id,
  query_text,
  content_type = null,
  limit = 10,
  lookback_days = null,
}) {
  await ensureSchema();
  const pool = getPool();
  
  let sql = `
    SELECT 
      id, agent_id, content, content_type, metadata, tags,
      importance_score, verified, created_at,
      ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as rank
    FROM agent_memory
    WHERE agent_id = $2
      AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
  `;
  
  const params = [query_text, agent_id];
  let paramIndex = 3;
  
  if (content_type) {
    sql += ` AND content_type = $${paramIndex}`;
    params.push(content_type);
    paramIndex++;
  }
  
  if (lookback_days) {
    sql += ` AND created_at >= NOW() - INTERVAL '${lookback_days} days'`;
  }
  
  sql += ` ORDER BY rank DESC, importance_score DESC, created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);
  
  try {
    const result = await pool.query(sql, params);
    return result.rows.map(row => ({
      ...row,
      rank: parseFloat(row.rank),
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    }));
  } catch (err) {
    console.error("[agent-memory-sql] Full-text search failed:", err.message);
    throw err;
  }
}

// ─── Get Recent Memories ───────────────────────────────────────────────────────

async function getRecentMemories(agent_id, limit = 20, lookback_days = 7) {
  await ensureSchema();
  const pool = getPool();
  
  try {
    const result = await pool.query(`
      SELECT 
        id, agent_id, content, content_type, metadata, tags,
        importance_score, verified, created_at
      FROM agent_memory
      WHERE agent_id = $1
        AND created_at >= NOW() - INTERVAL '${lookback_days} days'
      ORDER BY created_at DESC
      LIMIT $2
    `, [agent_id, limit]);
    
    return result.rows.map(row => ({
      ...row,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    }));
  } catch (err) {
    console.error("[agent-memory-sql] Get recent failed:", err.message);
    throw err;
  }
}

// ─── Update Memory ────────────────────────────────────────────────────────────

async function updateMemory(id, updates = {}) {
  await ensureSchema();
  const pool = getPool();
  
  const allowedFields = [
    "content", "content_type", "metadata", "tags", "importance_score",
    "verified", "expires_at",
  ];
  
  const setParts = [];
  const params = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      if (key === "metadata") {
        setParts.push(`${key} = $${paramIndex}::jsonb`);
        params.push(JSON.stringify(value));
      } else if (key === "tags") {
        setParts.push(`${key} = $${paramIndex}::text[]`);
        params.push(value);
      } else {
        setParts.push(`${key} = $${paramIndex}`);
        params.push(value);
      }
      paramIndex++;
    }
  }
  
  if (setParts.length === 0) {
    throw new Error("No valid fields to update");
  }
  
  params.push(id);
  
  try {
    const result = await pool.query(`
      UPDATE agent_memory
      SET ${setParts.join(", ")}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING id, updated_at
    `, params);
    
    return result.rows[0];
  } catch (err) {
    console.error("[agent-memory-sql] Update failed:", err.message);
    throw err;
  }
}

// ─── Mark Accessed ────────────────────────────────────────────────────────────

async function markAccessed(id) {
  await ensureSchema();
  const pool = getPool();
  
  try {
    await pool.query(`
      UPDATE agent_memory
      SET accessed_at = NOW()
      WHERE id = $1
    `, [id]);
  } catch (err) {
    console.error("[agent-memory-sql] Mark accessed failed:", err.message);
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ensureSchema,
  storeMemory,
  searchMemories,
  fullTextSearch,
  getRecentMemories,
  updateMemory,
  markAccessed,
  generateEmbedding,
};

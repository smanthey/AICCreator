-- Migration 074: SQL-based Agent Memory with Vector Search (pgvector optional)
-- Provides persistent, searchable agent memory with semantic search via embeddings
-- Complements the existing file-based memory system
-- 
-- NOTE: pgvector extension is optional. If not available, embeddings are stored as JSONB
-- and full-text search is used instead of vector similarity search.

-- Try to enable pgvector extension (optional - will fail gracefully if not installed)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available, using JSONB fallback for embeddings';
END $$;

-- Agent memory entries table
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  
  -- Memory content
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'learned' CHECK (content_type IN ('learned', 'insight', 'feedback', 'strategy', 'blocker', 'metric', 'summary')),
  
  -- Structured data
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  
  -- Vector embedding for semantic search (variable dimensions - supports OpenAI 1536, Ollama 768, etc.)
  -- If pgvector is available, this is a vector type. Otherwise, stored as JSONB.
  embedding JSONB,  -- Fallback: store as JSONB array if pgvector not available
  embedding_model TEXT,
  
  -- Context and lineage
  task_id UUID,
  plan_id UUID,
  run_id TEXT,
  source TEXT DEFAULT 'agent', -- 'agent', 'manual', 'feedback', 'system'
  
  -- Metrics and status
  importance_score NUMERIC(3,2) DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1),
  verified BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

-- Add vector column only if pgvector is available
DO $$
BEGIN
  -- Check if vector type exists (pgvector is installed)
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    -- Add vector column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'agent_memory' AND column_name = 'embedding_vector'
    ) THEN
      ALTER TABLE agent_memory ADD COLUMN embedding_vector vector;
      COMMENT ON COLUMN agent_memory.embedding_vector IS 'Vector embedding (pgvector) - synced with embedding JSONB';
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add vector column, using JSONB fallback';
END $$;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_created 
  ON agent_memory(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_type 
  ON agent_memory(agent_id, content_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_tags 
  ON agent_memory USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_agent_memory_metadata 
  ON agent_memory USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_agent_memory_importance 
  ON agent_memory(agent_id, importance_score DESC, created_at DESC);

-- Index for JSONB embedding (used when pgvector not available)
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding_jsonb 
  ON agent_memory USING GIN (embedding)
  WHERE embedding IS NOT NULL;

-- Vector similarity search index (only if pgvector is available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'idx_agent_memory_embedding_vector'
    ) THEN
      CREATE INDEX idx_agent_memory_embedding_vector 
        ON agent_memory USING hnsw (embedding_vector vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE embedding_vector IS NOT NULL;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not create vector index, using JSONB fallback';
END $$;

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_agent_memory_content_fts 
  ON agent_memory USING GIN (to_tsvector('english', content));

-- Agent memory search history (for improving relevance)
CREATE TABLE IF NOT EXISTS agent_memory_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  query_embedding JSONB,  -- Fallback: JSONB instead of vector
  results_count INTEGER NOT NULL DEFAULT 0,
  clicked_memory_id UUID REFERENCES agent_memory(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add vector column for searches if pgvector available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'agent_memory_searches' AND column_name = 'query_embedding_vector'
    ) THEN
      ALTER TABLE agent_memory_searches ADD COLUMN query_embedding_vector vector;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add vector column to searches table';
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_memory_searches_agent 
  ON agent_memory_searches(agent_id, created_at DESC);

-- Agent memory relationships (for linking related memories)
CREATE TABLE IF NOT EXISTS agent_memory_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id UUID NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
  to_memory_id UUID NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'related' CHECK (link_type IN ('related', 'causes', 'follows', 'contradicts', 'supports')),
  strength NUMERIC(3,2) DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_memory_id, to_memory_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_links_from 
  ON agent_memory_links(from_memory_id);

CREATE INDEX IF NOT EXISTS idx_agent_memory_links_to 
  ON agent_memory_links(to_memory_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_agent_memory_updated_at'
  ) THEN
    CREATE TRIGGER trigger_agent_memory_updated_at
      BEFORE UPDATE ON agent_memory
      FOR EACH ROW
      EXECUTE FUNCTION update_agent_memory_updated_at();
  END IF;
END $$;

-- Function to automatically expire old low-importance memories
CREATE OR REPLACE FUNCTION cleanup_expired_agent_memory()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM agent_memory
  WHERE expires_at IS NOT NULL 
    AND expires_at < NOW()
    AND importance_score < 0.3;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

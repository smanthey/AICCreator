# SQL Memory System

## Overview

The SQL Memory System provides persistent, searchable agent memory with semantic search capabilities using vector embeddings. It complements the existing file-based memory system (`agent-memory.js`) by providing:

- **Persistent storage** in PostgreSQL
- **Vector embeddings** for semantic similarity search
- **Full-text search** for keyword-based queries
- **Memory relationships** and linking
- **Automatic importance scoring**
- **Expiration and cleanup** of old memories

## Architecture

### Database Schema

The system uses the `agent_memory` table with the following key features:

- **Vector embeddings**: Stored using pgvector extension for semantic search
- **Content types**: `learned`, `insight`, `feedback`, `strategy`, `blocker`, `metric`, `summary`
- **Metadata**: JSONB field for flexible structured data
- **Tags**: Array field for categorization
- **Importance scoring**: 0.0-1.0 scale for relevance ranking

### Components

1. **Migration**: `migrations/074_agent_memory_sql.sql`
   - Creates `agent_memory` table with vector support
   - Creates `agent_memory_searches` for search analytics
   - Creates `agent_memory_links` for memory relationships

2. **Core Module**: `control/agent-memory-sql.js`
   - `storeMemory()` - Store new memories with optional embeddings
   - `searchMemories()` - Semantic search using vector similarity
   - `fullTextSearch()` - Keyword-based full-text search
   - `getRecentMemories()` - Retrieve recent memories by agent
   - `updateMemory()` - Update existing memories
   - `markAccessed()` - Track memory access

3. **Integration**: `control/agent-memory.js`
   - Automatically stores memories to SQL when `appendAgentDailyLog()` is called
   - Loads SQL memories into agent prelude for context
   - Provides `searchAgentMemory()` function

## Setup

### 1. Run Migration

```bash
psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -f migrations/074_agent_memory_sql.sql
```

Or the schema will be auto-created on first use.

### 2. Verify Installation

```bash
node scripts/agent-memory-sql-verify.js
```

### 3. Environment Variables

```bash
# Database (required)
CLAW_DB_HOST=192.168.1.164
CLAW_DB_PORT=15432
CLAW_DB_USER=claw
CLAW_DB_PASSWORD=your_password
CLAW_DB_NAME=claw_architect

# Embeddings (optional, defaults to Ollama)
OLLAMA_HOST=http://127.0.0.1:11434
AGENT_MEMORY_EMBEDDING_MODEL=mxbai-embed-large
```

## Usage

### Storing Memories

```javascript
const sqlMemory = require("./control/agent-memory-sql");

// Basic storage
await sqlMemory.storeMemory({
  agent_id: "my_agent",
  content: "Learned that users prefer shorter response times",
  content_type: "learned",
  tags: ["user-experience", "performance"],
  metadata: { metric: "response_time", value: 0.5 },
});

// With importance
await sqlMemory.storeMemory({
  agent_id: "my_agent",
  content: "Critical blocker: API rate limits exceeded",
  content_type: "blocker",
  importance_score: 0.9,
  verified: true,
});
```

### Semantic Search

```javascript
// Search by query text (auto-generates embedding)
const results = await sqlMemory.searchMemories({
  agent_id: "my_agent",
  query: "user preferences response time",
  limit: 10,
  min_similarity: 0.7,
});

// Search with existing embedding
const results = await sqlMemory.searchMemories({
  agent_id: "my_agent",
  query_embedding: [0.1, 0.2, ...], // 1536-dim vector
  limit: 10,
});
```

### Full-Text Search

```javascript
const results = await sqlMemory.fullTextSearch({
  agent_id: "my_agent",
  query_text: "rate limit",
  limit: 10,
});
```

### Retrieving Recent Memories

```javascript
const recent = await sqlMemory.getRecentMemories(
  "my_agent",
  20,      // limit
  7        // lookback_days
);
```

### Updating Memories

```javascript
await sqlMemory.updateMemory(memoryId, {
  importance_score: 0.9,
  verified: true,
  tags: ["verified", "important"],
});
```

## Integration with Agent System

The SQL memory system is automatically integrated:

1. **Automatic Storage**: When agents call `appendAgentDailyLog()`, memories are automatically stored to SQL:
   - `learned` entries → stored as "learned" type
   - `blocker` entries → stored as "blocker" type with high importance
   - `next_focus` entries → stored as "strategy" type

2. **Automatic Loading**: When agents load their prelude via `loadAgentPrelude()`, recent high-importance SQL memories are included in context.

3. **Search Integration**: Agents can search their memories:
   ```javascript
   const { searchAgentMemory } = require("./control/agent-memory");
   const results = await searchAgentMemory("my_agent", "user preferences");
   ```

## Bot Collection System Integration

The bot collection system uses SQL memory for:

- **Learning Insights**: Stored via `bot-learning-system.js` → `saveInsight()`
- **Strategy Generation**: Can search past strategies and insights
- **Performance Tracking**: Metrics and learnings stored for analysis

## Performance Considerations

- **Vector Index**: Uses HNSW index for fast approximate similarity search
- **Embedding Generation**: Uses local Ollama by default (free, fast)
- **Caching**: Consider caching frequently accessed memories
- **Cleanup**: Old low-importance memories can be automatically expired

## Maintenance

### Cleanup Expired Memories

```sql
SELECT cleanup_expired_agent_memory();
```

### View Memory Statistics

```sql
SELECT 
  agent_id,
  content_type,
  COUNT(*) as count,
  AVG(importance_score) as avg_importance
FROM agent_memory
GROUP BY agent_id, content_type
ORDER BY agent_id, count DESC;
```

### Re-embedding Memories

If you change embedding models, you may need to re-embed existing memories:

```javascript
const memories = await sqlMemory.getRecentMemories("agent", 1000, 365);
for (const mem of memories) {
  if (!mem.embedding) {
    const embedding = await sqlMemory.generateEmbedding(mem.content);
    await sqlMemory.updateMemory(mem.id, {
      embedding: embedding.vector,
      embedding_model: embedding.model,
    });
  }
}
```

## Troubleshooting

### "Extension vector does not exist"

Install pgvector extension:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### "Embedding generation failed"

- Check Ollama is running: `curl http://127.0.0.1:11434/api/tags`
- Verify embedding model is available: `ollama pull mxbai-embed-large`
- Check network connectivity to Ollama

### "No memories found in search"

- Verify memories exist: `SELECT COUNT(*) FROM agent_memory WHERE agent_id = 'your_agent';`
- Check embedding was generated: `SELECT COUNT(*) FROM agent_memory WHERE embedding IS NOT NULL;`
- Lower `min_similarity` threshold (default 0.7)

## Future Enhancements

- [ ] Memory deduplication based on similarity
- [ ] Automatic memory summarization
- [ ] Memory clustering and topic modeling
- [ ] Cross-agent memory sharing
- [ ] Memory versioning and history
- [ ] Integration with external vector databases (Pinecone, Weaviate)

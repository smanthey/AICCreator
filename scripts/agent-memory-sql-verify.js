#!/usr/bin/env node
"use strict";

/**
 * agent-memory-sql-verify.js
 * 
 * Verify SQL memory system is set up and working correctly.
 */

require("dotenv").config({ override: true });

const sqlMemory = require("../control/agent-memory-sql");

async function main() {
  console.log("🔍 Verifying SQL Memory System...\n");
  
  try {
    // 1. Ensure schema
    console.log("1. Ensuring schema...");
    await sqlMemory.ensureSchema();
    console.log("   ✅ Schema ready\n");
    
    // 2. Test store
    console.log("2. Testing memory storage...");
    const testMemory = await sqlMemory.storeMemory({
      agent_id: "test_agent",
      content: "This is a test memory entry to verify the SQL memory system is working correctly.",
      content_type: "learned",
      tags: ["test", "verification"],
      metadata: { test: true },
    });
    console.log(`   ✅ Stored memory: ${testMemory.id}\n`);
    
    // 3. Test search
    console.log("3. Testing semantic search...");
    const searchResults = await sqlMemory.searchMemories({
      agent_id: "test_agent",
      query: "test memory verification",
      limit: 5,
    });
    console.log(`   ✅ Found ${searchResults.length} memories\n`);
    
    // 4. Test full-text search
    console.log("4. Testing full-text search...");
    const textResults = await sqlMemory.fullTextSearch({
      agent_id: "test_agent",
      query_text: "test memory",
      limit: 5,
    });
    console.log(`   ✅ Found ${textResults.length} memories\n`);
    
    // 5. Test recent memories
    console.log("5. Testing recent memories retrieval...");
    const recent = await sqlMemory.getRecentMemories("test_agent", 10, 7);
    console.log(`   ✅ Retrieved ${recent.length} recent memories\n`);
    
    // 6. Test update
    console.log("6. Testing memory update...");
    const updated = await sqlMemory.updateMemory(testMemory.id, {
      importance_score: 0.9,
      verified: true,
    });
    console.log(`   ✅ Updated memory: ${updated.id}\n`);
    
    // 7. Cleanup test data
    console.log("7. Cleaning up test data...");
    const pool = sqlMemory.getPool ? sqlMemory.getPool() : require("pg").Pool;
    // Note: We'd need to expose getPool or use a different approach
    console.log("   ⚠️  Test memory left in database (id: " + testMemory.id + ")\n");
    
    console.log("✅ SQL Memory System Verification Complete!");
    console.log("\nThe system is ready to use.");
    console.log("\nUsage:");
    console.log("  const sqlMemory = require('./control/agent-memory-sql');");
    console.log("  await sqlMemory.storeMemory({ agent_id: 'my_agent', content: '...' });");
    console.log("  const results = await sqlMemory.searchMemories({ agent_id: 'my_agent', query: '...' });");
    
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = { main };

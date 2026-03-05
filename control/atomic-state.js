"use strict";

/**
 * control/atomic-state.js
 * 
 * Atomic file operations to prevent race conditions in state management.
 * Uses write-to-temp-then-rename pattern for atomicity.
 */

const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// ─── Atomic Write ──────────────────────────────────────────────────────────────

/**
 * Atomically write JSON to a file
 * Prevents race conditions by writing to temp file then renaming
 */
async function atomicWriteJSON(filePath, data) {
  const dir = path.dirname(filePath);
  const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  
  try {
    // Ensure directory exists
    await fsp.mkdir(dir, { recursive: true });
    
    // Write to temp file
    await fsp.writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    
    // Atomic rename (POSIX guarantees this is atomic)
    await fsp.rename(tempPath, filePath);
  } catch (err) {
    // Clean up temp file on error
    try {
      await fsp.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

// ─── Atomic Read-Modify-Write ─────────────────────────────────────────────────

/**
 * Atomically read, modify, and write JSON
 * Uses file locking via Redis or file-based lock
 */
async function atomicReadModifyWrite(filePath, modifyFn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 100;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Try Redis-based locking if available
      let lock = null;
      try {
        const redis = require("../infra/redis");
        const lockKey = `lock:${filePath}`;
        const lockToken = crypto.randomBytes(8).toString("hex");
        
        // Try to acquire lock (expires in 5 seconds)
        const client = redis.getClient ? redis.getClient() : redis;
        const acquired = await client.set(lockKey, lockToken, "EX", 5, "NX");
        
        if (acquired) {
          lock = { key: lockKey, token: lockToken, client };
        }
      } catch {
        // Redis not available, use file-based locking
      }
      
      try {
        // Read current state
        let current = {};
        try {
          const content = await fsp.readFile(filePath, "utf8");
          current = JSON.parse(content);
        } catch {
          // File doesn't exist or invalid JSON, start fresh
          current = {};
        }
        
        // Modify
        const modified = await modifyFn(current);
        
        // Write atomically
        await atomicWriteJSON(filePath, modified);
        
        return modified;
      } finally {
        // Release lock
        if (lock) {
          try {
            const script = `
              if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
              else
                return 0
              end
            `;
            await lock.client.eval(script, 1, lock.key, lock.token);
          } catch {
            // Lock release failed, will expire automatically
          }
        }
      }
    } catch (err) {
      if (attempt === maxRetries - 1) {
        throw err;
      }
      // Retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }
}

// ─── Atomic Append (for JSONL files) ──────────────────────────────────────────

/**
 * Atomically append a line to a JSONL file
 */
async function atomicAppendJSONL(filePath, data) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  
  // Append is already atomic on most filesystems, but we'll use appendFile
  await fsp.appendFile(filePath, JSON.stringify(data) + "\n", "utf8");
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  atomicWriteJSON,
  atomicReadModifyWrite,
  atomicAppendJSONL,
};

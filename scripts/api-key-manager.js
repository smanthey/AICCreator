#!/usr/bin/env node
"use strict";

/**
 * api-key-manager.js — Secure API Key Management System
 * 
 * Manages API keys for bots and services:
 * - Secure key generation and storage
 * - Key rotation and expiration
 * - Access control and permissions
 * - Integration with Stripe, Anthropic, OpenAI, etc.
 * - Encrypted storage with key derivation
 */

require("dotenv").config({ override: true });

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

const ROOT = path.join(__dirname, "..");
const KEYS_DIR = path.join(ROOT, "agent-state", "api-keys");
const KEYS_FILE = path.join(KEYS_DIR, "keys.json");

// Database connection
let pool = null;
let useDatabase = false;

// Initialize database connection (non-blocking)
async function initDatabase() {
  if (pool) return; // Already initialized
  
  try {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
      port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
      user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
      password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
      database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
    
    // Test connection
    await pool.query("SELECT 1");
    useDatabase = true;
    console.log("[api-key-manager] Using database for key storage");
    
    // Handle pool errors gracefully
    pool.on("error", (err) => {
      console.warn("[api-key-manager] Database pool error:", err.message);
      useDatabase = false;
    });
  } catch (err) {
    console.warn("[api-key-manager] Database not available, using file storage:", err.message);
    useDatabase = false;
    if (pool) {
      try {
        await pool.end();
      } catch {}
      pool = null;
    }
  }
}

// Auto-initialize on first use
let initPromise = null;
async function ensureDatabase() {
  if (!initPromise) {
    initPromise = initDatabase();
  }
  await initPromise;
}

// ─── Encryption ───────────────────────────────────────────────────────────

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_ITERATIONS = 100000;

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, KEY_DERIVATION_ITERATIONS, 32, "sha256");
}

function encryptValue(value, masterKey) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(masterKey, salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

function decryptValue(encryptedData, masterKey) {
  const salt = Buffer.from(encryptedData.salt, "hex");
  const key = deriveKey(masterKey, salt);
  const iv = Buffer.from(encryptedData.iv, "hex");
  const authTag = Buffer.from(encryptedData.authTag, "hex");
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

// ─── Database Schema ────────────────────────────────────────────────────────

async function ensureKeysSchema() {
  await ensureDatabase();
  if (!useDatabase || !pool) return;
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY,
        key_name TEXT NOT NULL,
        key_type TEXT NOT NULL, -- stripe, anthropic, openai, discord, telegram, etc.
        key_value_encrypted TEXT NOT NULL,
        key_salt TEXT NOT NULL,
        key_iv TEXT NOT NULL,
        key_auth_tag TEXT NOT NULL,
        bot_id TEXT,
        service_name TEXT,
        permissions TEXT[] DEFAULT '{}',
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        usage_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(key_name, bot_id)
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(key_type);
      CREATE INDEX IF NOT EXISTS idx_api_keys_bot_id ON api_keys(bot_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
    `);
    
    console.log("[api-key-manager] Schema ensured");
  } catch (err) {
    console.error("[api-key-manager] Schema creation failed:", err.message);
    useDatabase = false;
  }
}

// ─── Key Management ────────────────────────────────────────────────────────

function getMasterKey() {
  const masterKey = process.env.API_KEY_MASTER_KEY || process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error("API_KEY_MASTER_KEY or MASTER_ENCRYPTION_KEY must be set in .env");
  }
  return masterKey;
}

async function storeKey(keyName, keyType, keyValue, options = {}) {
  const masterKey = getMasterKey();
  const encrypted = encryptValue(keyValue, masterKey);
  
  const keyData = {
    key_name: keyName,
    key_type: keyType,
    key_value_encrypted: encrypted.encrypted,
    key_salt: encrypted.salt,
    key_iv: encrypted.iv,
    key_auth_tag: encrypted.authTag,
    bot_id: options.bot_id || null,
    service_name: options.service_name || null,
    permissions: options.permissions || [],
    expires_at: options.expires_at || null,
    status: "active",
  };
  
  await ensureDatabase();
  if (useDatabase && pool) {
    try {
      await pool.query(`
        INSERT INTO api_keys (
          key_name, key_type, key_value_encrypted, key_salt, key_iv, key_auth_tag,
          bot_id, service_name, permissions, expires_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (key_name, bot_id) DO UPDATE SET
          key_value_encrypted = EXCLUDED.key_value_encrypted,
          key_salt = EXCLUDED.key_salt,
          key_iv = EXCLUDED.key_iv,
          key_auth_tag = EXCLUDED.key_auth_tag,
          service_name = EXCLUDED.service_name,
          permissions = EXCLUDED.permissions,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()
        RETURNING id, key_name, key_type, bot_id, status, created_at
      `, [
        keyData.key_name,
        keyData.key_type,
        keyData.key_value_encrypted,
        keyData.key_salt,
        keyData.key_iv,
        keyData.key_auth_tag,
        keyData.bot_id,
        keyData.service_name,
        keyData.permissions,
        keyData.expires_at,
        keyData.status,
      ]);
    } catch (err) {
      console.error("[api-key-manager] Database storage failed:", err.message);
      useDatabase = false;
    }
  }
  
  // Fallback to file storage (encrypted)
  const keys = await loadKeysFile();
  keys[keyName] = {
    ...keyData,
    bot_id: keyData.bot_id || "global",
  };
  await saveKeysFile(keys);
  
  return keyData;
}

async function retrieveKey(keyName, botId = null) {
  const masterKey = getMasterKey();
  await ensureDatabase();
  
  if (useDatabase && pool) {
    try {
      const result = await pool.query(`
        SELECT * FROM api_keys
        WHERE key_name = $1 AND (bot_id = $2 OR bot_id IS NULL)
        AND status = 'active'
        ORDER BY bot_id DESC NULLS LAST
        LIMIT 1
      `, [keyName, botId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const key = result.rows[0];
      
      // Check expiration
      if (key.expires_at && new Date(key.expires_at) < new Date()) {
        await pool.query(`UPDATE api_keys SET status = 'expired' WHERE id = $1`, [key.id]);
        return null;
      }
      
      // Decrypt
      const encryptedData = {
        encrypted: key.key_value_encrypted,
        salt: key.key_salt,
        iv: key.key_iv,
        authTag: key.key_auth_tag,
      };
      
      const decrypted = decryptValue(encryptedData, masterKey);
      
      // Update usage
      await pool.query(`
        UPDATE api_keys
        SET last_used_at = NOW(), usage_count = usage_count + 1
        WHERE id = $1
      `, [key.id]);
      
      return {
        key_name: key.key_name,
        key_type: key.key_type,
        key_value: decrypted,
        bot_id: key.bot_id,
        permissions: key.permissions,
      };
    } catch (err) {
      console.error("[api-key-manager] Database retrieval failed:", err.message);
      useDatabase = false;
    }
  }
  
  // Fallback to file storage
  const keys = await loadKeysFile();
  const keyId = botId ? `${keyName}:${botId}` : keyName;
  const key = keys[keyId] || keys[keyName];
  
  if (!key) {
    return null;
  }
  
  // Decrypt
  const encryptedData = {
    encrypted: key.key_value_encrypted,
    salt: key.key_salt,
    iv: key.key_iv,
    authTag: key.key_auth_tag,
  };
  
  const decrypted = decryptValue(encryptedData, masterKey);
  
  return {
    key_name: key.key_name,
    key_type: key.key_type,
    key_value: decrypted,
    bot_id: key.bot_id,
    permissions: key.permissions,
  };
}

async function revokeKey(keyName, botId = null) {
  await ensureDatabase();
  
  if (useDatabase && pool) {
    try {
      await pool.query(`
        UPDATE api_keys
        SET status = 'revoked', updated_at = NOW()
        WHERE key_name = $1 AND (bot_id = $2 OR bot_id IS NULL)
      `, [keyName, botId]);
    } catch (err) {
      console.error("[api-key-manager] Database revocation failed:", err.message);
    }
  }
  
  // File storage
  const keys = await loadKeysFile();
  const keyId = botId ? `${keyName}:${botId}` : keyName;
  if (keys[keyId]) {
    keys[keyId].status = "revoked";
    await saveKeysFile(keys);
  }
}

// ─── Key Generation ────────────────────────────────────────────────────────

function generateAPIKey(prefix = "key", length = 32) {
  const randomBytes = crypto.randomBytes(length);
  const key = `${prefix}_${randomBytes.toString("hex")}`;
  return key;
}

// ─── File Storage (Fallback) ───────────────────────────────────────────────

async function loadKeysFile() {
  try {
    const data = await fsp.readFile(KEYS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    // File doesn't exist or is invalid - return empty object
    if (err.code !== "ENOENT") {
      console.warn("[api-key-manager] Error loading keys file:", err.message);
    }
    return {};
  }
}

async function saveKeysFile(keys) {
  try {
    await fsp.mkdir(KEYS_DIR, { recursive: true });
    await fsp.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch (err) {
    console.error("[api-key-manager] Error saving keys file:", err.message);
    throw err;
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  
  await ensureKeysSchema();
  
  if (command === "store" && args.length >= 3) {
    const keyName = args[1];
    const keyType = args[2];
    const keyValue = args[3] || process.env[keyName.toUpperCase()];
    
    if (!keyValue) {
      console.error(`Key value not provided and ${keyName.toUpperCase()} not in environment`);
      process.exit(1);
    }
    
    const options = {
      bot_id: args[4] || null,
      service_name: args[5] || null,
    };
    
    await storeKey(keyName, keyType, keyValue, options);
    console.log(`✅ Stored key: ${keyName} (${keyType})`);
  } else if (command === "get" && args[1]) {
    const keyName = args[1];
    const botId = args[2] || null;
    
    const key = await retrieveKey(keyName, botId);
    if (key) {
      console.log(`Key: ${key.key_name}`);
      console.log(`Type: ${key.key_type}`);
      console.log(`Value: ${key.key_value}`);
      if (key.bot_id) console.log(`Bot ID: ${key.bot_id}`);
    } else {
      console.error(`Key not found: ${keyName}`);
      process.exit(1);
    }
  } else if (command === "revoke" && args[1]) {
    const keyName = args[1];
    const botId = args[2] || null;
    
    await revokeKey(keyName, botId);
    console.log(`✅ Revoked key: ${keyName}`);
  } else if (command === "generate" && args[1]) {
    const prefix = args[1];
    const length = args[2] ? parseInt(args[2]) : 32;
    
    const key = generateAPIKey(prefix, length);
    console.log(`Generated key: ${key}`);
  } else {
    console.log(`
api-key-manager.js — Secure API Key Management

Commands:
  node scripts/api-key-manager.js store <key_name> <key_type> [key_value] [bot_id] [service_name]
  node scripts/api-key-manager.js get <key_name> [bot_id]
  node scripts/api-key-manager.js revoke <key_name> [bot_id]
  node scripts/api-key-manager.js generate <prefix> [length]

Examples:
  node scripts/api-key-manager.js store stripe_secret stripe sk_live_xxx
  node scripts/api-key-manager.js get stripe_secret
  node scripts/api-key-manager.js revoke stripe_secret
  node scripts/api-key-manager.js generate bot_key 32

Note: Keys are encrypted at rest. Set API_KEY_MASTER_KEY in .env
    `);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  storeKey,
  retrieveKey,
  revokeKey,
  generateAPIKey,
  ensureKeysSchema,
};

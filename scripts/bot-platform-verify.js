#!/usr/bin/env node
"use strict";

/**
 * bot-platform-verify.js — System Verification Script
 * 
 * Verifies all components of the bot platform are functioning correctly:
 * - Database connectivity
 * - File storage fallback
 * - Module exports
 * - Error handling
 * - Integration points
 */

require("dotenv").config({ override: true });

const path = require("path");

let errors = [];
let warnings = [];
let passed = [];

async function testModule(name, modulePath) {
  try {
    const mod = require(modulePath);
    passed.push(`✓ ${name} module loads successfully`);
    return mod;
  } catch (err) {
    errors.push(`✗ ${name} module failed to load: ${err.message}`);
    return null;
  }
}

async function testDatabase() {
  try {
    const { ensureRegistrySchema } = require("./bot-registry");
    await ensureRegistrySchema();
    passed.push("✓ Database schema can be ensured");
  } catch (err) {
    warnings.push(`⚠ Database schema check: ${err.message} (file storage fallback available)`);
  }
}

async function testFileStorage() {
  try {
    const { registerBot, getBot } = require("./bot-registry");
    const testBotId = `test_${Date.now()}`;
    
    // Test registration
    const bot = await registerBot({
      bot_id: testBotId,
      bot_name: "Test Bot",
      platform: "test",
      capabilities: ["test"],
    });
    
    if (bot && bot.bot_id === testBotId) {
      passed.push("✓ Bot registration works (database or file storage)");
    } else {
      errors.push("✗ Bot registration returned invalid data");
    }
    
    // Test retrieval
    const retrieved = await getBot(testBotId);
    if (retrieved && retrieved.bot_id === testBotId) {
      passed.push("✓ Bot retrieval works");
    } else {
      errors.push("✗ Bot retrieval failed");
    }
  } catch (err) {
    errors.push(`✗ File storage test failed: ${err.message}`);
  }
}

async function testAPIKeyManager() {
  try {
    const { storeKey, retrieveKey, generateAPIKey } = require("./api-key-manager");
    
    // Test key generation
    const key = generateAPIKey("test", 16);
    if (key && key.startsWith("test_")) {
      passed.push("✓ API key generation works");
    } else {
      errors.push("✗ API key generation failed");
    }
    
    // Test encryption (if master key is set)
    if (process.env.API_KEY_MASTER_KEY || process.env.MASTER_ENCRYPTION_KEY) {
      try {
        await storeKey("test_key", "test", "test_value", { bot_id: "test_bot" });
        const retrieved = await retrieveKey("test_key", "test_bot");
        if (retrieved && retrieved.key_value === "test_value") {
          passed.push("✓ API key encryption/decryption works");
        } else {
          errors.push("✗ API key retrieval failed");
        }
      } catch (err) {
        warnings.push(`⚠ API key storage test: ${err.message}`);
      }
    } else {
      warnings.push("⚠ API_KEY_MASTER_KEY not set - skipping encryption test");
    }
  } catch (err) {
    errors.push(`✗ API key manager test failed: ${err.message}`);
  }
}

async function testProtocols() {
  try {
    const { PROTOCOLS } = require("./bot-protocol");
    
    const requiredProtocols = ["agent-intro", "commerce", "collaboration", "discovery", "reputation"];
    const missing = requiredProtocols.filter(p => !PROTOCOLS[p]);
    
    if (missing.length === 0) {
      passed.push("✓ All required protocols are defined");
    } else {
      errors.push(`✗ Missing protocols: ${missing.join(", ")}`);
    }
  } catch (err) {
    errors.push(`✗ Protocol test failed: ${err.message}`);
  }
}

async function testAccountProvisioner() {
  try {
    const { 
      provisionStripeAccount,
      provisionDiscordBot,
      provisionTelegramBot,
      provisionAnthropicKey,
    } = require("./account-provisioner");
    
    if (typeof provisionStripeAccount === "function" &&
        typeof provisionDiscordBot === "function" &&
        typeof provisionTelegramBot === "function" &&
        typeof provisionAnthropicKey === "function") {
      passed.push("✓ Account provisioner functions are available");
    } else {
      errors.push("✗ Account provisioner functions missing");
    }
  } catch (err) {
    errors.push(`✗ Account provisioner test failed: ${err.message}`);
  }
}

async function testIntegration() {
  try {
    // Test that modules can import each other
    const registry = require("./bot-registry");
    const protocol = require("./bot-protocol");
    const keys = require("./api-key-manager");
    const provisioner = require("./account-provisioner");
    
    if (registry && protocol && keys && provisioner) {
      passed.push("✓ All modules can be imported together");
    }
  } catch (err) {
    errors.push(`✗ Integration test failed: ${err.message}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Bot Platform System Verification");
  console.log("=".repeat(60));
  console.log();
  
  // Test module loading
  console.log("Testing module loading...");
  await testModule("bot-registry", "./bot-registry");
  await testModule("bot-protocol", "./bot-protocol");
  await testModule("api-key-manager", "./api-key-manager");
  await testModule("account-provisioner", "./account-provisioner");
  await testModule("bot-platform", "./bot-platform");
  console.log();
  
  // Test database
  console.log("Testing database connectivity...");
  await testDatabase();
  console.log();
  
  // Test file storage
  console.log("Testing file storage fallback...");
  await testFileStorage();
  console.log();
  
  // Test API key manager
  console.log("Testing API key management...");
  await testAPIKeyManager();
  console.log();
  
  // Test protocols
  console.log("Testing communication protocols...");
  await testProtocols();
  console.log();
  
  // Test account provisioner
  console.log("Testing account provisioner...");
  await testAccountProvisioner();
  console.log();
  
  // Test integration
  console.log("Testing module integration...");
  await testIntegration();
  console.log();
  
  // Summary
  console.log("=".repeat(60));
  console.log("Verification Summary");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${passed.length}`);
  passed.forEach(msg => console.log(`  ${msg}`));
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings: ${warnings.length}`);
    warnings.forEach(msg => console.log(`  ${msg}`));
  }
  
  if (errors.length > 0) {
    console.log(`\n❌ Errors: ${errors.length}`);
    errors.forEach(msg => console.log(`  ${msg}`));
    console.log("\n⚠️  Some errors detected. Review and fix before deployment.");
    process.exit(1);
  } else {
    console.log("\n✅ All critical tests passed! System is ready.");
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal verification error:", err.message);
    process.exit(1);
  });
}

module.exports = { main };

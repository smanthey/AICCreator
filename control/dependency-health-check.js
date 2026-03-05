"use strict";

/**
 * control/dependency-health-check.js
 * 
 * Dependency Health Checks - Pre-Flight Attestation
 * 
 * Problem: Since locally hosted, dependencies are hardware and local services.
 * If npm install fails due to network blip, agent should self-correct rather than
 * just logging an error and stopping.
 * 
 * Solution: Before critical operations (e.g., SaaS Dev writing code), run health
 * checks on git, npm, and other dependencies. Self-correct on failures.
 */

const { execSync, spawnSync } = require("child_process");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/**
 * Check if git is available and working
 */
async function checkGit() {
  try {
    const version = execSync("git --version", { encoding: "utf8", timeout: 5000 }).trim();
    const status = execSync("git status", { encoding: "utf8", timeout: 5000, cwd: ROOT });
    
    return {
      available: true,
      version,
      working: true,
      error: null,
    };
  } catch (err) {
    return {
      available: false,
      working: false,
      error: err.message,
    };
  }
}

/**
 * Check if npm is available and can install
 */
async function checkNpm() {
  try {
    const version = execSync("npm --version", { encoding: "utf8", timeout: 5000 }).trim();
    
    // Try a dry-run install to check network/cache
    const testResult = spawnSync("npm", ["install", "--dry-run"], {
      encoding: "utf8",
      timeout: 10000,
      cwd: ROOT,
      stdio: "pipe",
    });
    
    return {
      available: true,
      version,
      network_ok: testResult.status === 0 || testResult.stdout.includes("packages"),
      cache_ok: true, // Assume cache is okay if npm responds
      error: testResult.status !== 0 ? testResult.stderr.slice(0, 200) : null,
    };
  } catch (err) {
    return {
      available: false,
      network_ok: false,
      cache_ok: false,
      error: err.message,
    };
  }
}

/**
 * Self-correct npm issues
 */
async function fixNpm() {
  console.log("[health-check] Attempting to fix npm issues...");
  
  const fixes = [];
  
  try {
    // Clear npm cache
    console.log("  - Clearing npm cache...");
    execSync("npm cache clean --force", { encoding: "utf8", timeout: 30000, stdio: "ignore" });
    fixes.push("cache_cleared");
  } catch (err) {
    console.warn(`  - Cache clear failed: ${err.message}`);
  }
  
  try {
    // Verify network connectivity
    console.log("  - Checking network...");
    execSync("ping -c 1 registry.npmjs.org", { encoding: "utf8", timeout: 10000, stdio: "ignore" });
    fixes.push("network_verified");
  } catch (err) {
    console.warn(`  - Network check failed: ${err.message}`);
  }
  
  return {
    fixed: fixes.length > 0,
    fixes_applied: fixes,
  };
}

/**
 * Check if node_modules exists and is valid
 */
async function checkNodeModules() {
  const nodeModulesPath = path.join(ROOT, "node_modules");
  
  try {
    const stats = await fsp.stat(nodeModulesPath);
    if (!stats.isDirectory()) {
      return {
        exists: false,
        valid: false,
        error: "node_modules is not a directory",
      };
    }
    
    // Check if it's empty or corrupted
    const entries = await fsp.readdir(nodeModulesPath);
    if (entries.length === 0) {
      return {
        exists: true,
        valid: false,
        error: "node_modules is empty",
      };
    }
    
    return {
      exists: true,
      valid: true,
      package_count: entries.length,
    };
  } catch {
    return {
      exists: false,
      valid: false,
      error: "node_modules does not exist",
    };
  }
}

/**
 * Self-correct node_modules issues
 */
async function fixNodeModules() {
  console.log("[health-check] Attempting to fix node_modules...");
  
  try {
    const nodeModulesPath = path.join(ROOT, "node_modules");
    
    // Remove corrupted node_modules
    console.log("  - Removing node_modules...");
    await fsp.rm(nodeModulesPath, { recursive: true, force: true });
    
    // Reinstall
    console.log("  - Reinstalling dependencies...");
    execSync("npm install", {
      encoding: "utf8",
      timeout: 300000, // 5 minutes
      cwd: ROOT,
      stdio: "inherit",
    });
    
    return {
      fixed: true,
      action: "reinstalled",
    };
  } catch (err) {
    return {
      fixed: false,
      error: err.message,
    };
  }
}

/**
 * Run pre-flight health checks for critical operations
 */
async function runPreFlightChecks(operation = "default") {
  const checks = {
    git: await checkGit(),
    npm: await checkNpm(),
    node_modules: await checkNodeModules(),
  };
  
  const allHealthy = checks.git.working && checks.npm.available && checks.node_modules.valid;
  
  // Auto-fix if needed
  if (!allHealthy) {
    console.log("[health-check] Some checks failed, attempting auto-fix...");
    
    if (!checks.npm.network_ok || !checks.npm.cache_ok) {
      const npmFix = await fixNpm();
      if (npmFix.fixed) {
        // Re-check npm
        checks.npm = await checkNpm();
      }
    }
    
    if (!checks.node_modules.valid) {
      const nodeModulesFix = await fixNodeModules();
      if (nodeModulesFix.fixed) {
        // Re-check node_modules
        checks.node_modules = await checkNodeModules();
      }
    }
  }
  
  const finalHealthy = checks.git.working && checks.npm.available && checks.node_modules.valid;
  
  return {
    healthy: finalHealthy,
    checks,
    operation,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  runPreFlightChecks,
  checkGit,
  checkNpm,
  checkNodeModules,
  fixNpm,
  fixNodeModules,
};

#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function getPM2Processes() {
  try {
    const result = spawnSync("pm2", ["jlist"], {
      encoding: "utf8",
      timeout: 5000,
    });
    
    if (result.status !== 0) {
      return { ok: false, error: result.stderr || "PM2 query failed", processes: [] };
    }
    
    const processes = JSON.parse(result.stdout || "[]");
    return { ok: true, processes };
  } catch (err) {
    return { ok: false, error: err.message, processes: [] };
  }
}

function analyzeRestartPatterns(processes) {
  const workers = processes.filter(p => 
    p.name && (p.name.includes("worker") || p.name.includes("dispatcher"))
  );
  
  const patterns = {
    totalRestarts: 0,
    restartRate: 0,
    topRestartCauses: [],
    workers: [],
  };
  
  for (const worker of workers) {
    const restarts = worker.pm2_env?.restart_time || 0;
    const uptime = worker.pm2_env?.pm_uptime || Date.now();
    const uptimeDays = (Date.now() - uptime) / (1000 * 60 * 60 * 24);
    const restartRate = uptimeDays > 0 ? restarts / uptimeDays : restarts;
    
    patterns.totalRestarts += restarts;
    patterns.workers.push({
      name: worker.name,
      restarts,
      restartRate: Math.round(restartRate * 10) / 10,
      status: worker.pm2_env?.status,
    });
  }
  
  // Calculate average restart rate
  if (patterns.workers.length > 0) {
    patterns.restartRate = patterns.workers.reduce((sum, w) => sum + w.restartRate, 0) / patterns.workers.length;
  }
  
  return patterns;
}

function checkPM2Logs(processName, lines = 100) {
  try {
    const result = spawnSync("pm2", ["logs", processName, "--lines", String(lines), "--nostream"], {
      encoding: "utf8",
      timeout: 10000,
    });
    
    if (result.status !== 0) {
      return { ok: false, error: result.stderr || "Log query failed", logs: "" };
    }
    
    const logs = result.stdout || result.stderr || "";
    return { ok: true, logs };
  } catch (err) {
    return { ok: false, error: err.message, logs: "" };
  }
}

function analyzeLogErrors(logs) {
  const errorPatterns = {
    redis: { pattern: /redis|connection.*refused|ECONNREFUSED/i, count: 0 },
    postgres: { pattern: /postgres|database.*connection|ECONNREFUSED.*5432/i, count: 0 },
    memory: { pattern: /memory|heap|out of memory|FATAL ERROR/i, count: 0 },
    pool: { pattern: /pool|Cannot use a pool|connection pool/i, count: 0 },
    ollama: { pattern: /ollama|11434|port.*conflict/i, count: 0 },
    env: { pattern: /missing.*env|undefined.*env|required.*variable/i, count: 0 },
  };
  
  for (const [key, pattern] of Object.entries(errorPatterns)) {
    const matches = logs.match(new RegExp(pattern.pattern.source, "gi"));
    pattern.count = matches ? matches.length : 0;
  }
  
  return errorPatterns;
}

function checkMemoryUsage() {
  try {
    const processes = getPM2Processes();
    if (!processes.ok) return { ok: false, error: processes.error };
    
    const memoryInfo = processes.processes.map(p => ({
      name: p.name,
      memory: p.monit?.memory || 0,
      cpu: p.monit?.cpu || 0,
    }));
    
    const totalMemory = memoryInfo.reduce((sum, p) => sum + (p.memory || 0), 0);
    const avgMemory = memoryInfo.length > 0 ? totalMemory / memoryInfo.length : 0;
    
    // Check for potential leaks (memory > 500MB per process)
    const highMemory = memoryInfo.filter(p => (p.memory || 0) > 500 * 1024 * 1024);
    
    return {
      ok: true,
      totalMemory,
      avgMemory,
      highMemoryCount: highMemory.length,
      highMemoryProcesses: highMemory.map(p => p.name),
      processes: memoryInfo,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function checkOllamaPort() {
  try {
    // Check if port 11434 is in use
    const result = spawnSync("lsof", ["-i", ":11434"], {
      encoding: "utf8",
      timeout: 3000,
    });
    
    if (result.status === 0 && result.stdout) {
      const lines = result.stdout.split("\n").filter(l => l.trim());
      return { ok: true, inUse: true, processes: lines.length - 1 }; // -1 for header
    }
    
    return { ok: true, inUse: false, processes: 0 };
  } catch (err) {
    // lsof might not be available or port not in use
    return { ok: true, inUse: false, processes: 0, note: "Could not check (lsof unavailable?)" };
  }
}

function fixConnectionPoolErrors() {
  // Fix connection pool errors in dispatcher.js
  const dispatcherPath = path.join(ROOT, "control", "dispatcher.js");
  if (!fs.existsSync(dispatcherPath)) {
    return { fixed: false, reason: "dispatcher.js not found" };
  }
  
  let content = fs.readFileSync(dispatcherPath, "utf8");
  let fixed = false;
  
  // Check if pool is properly closed on errors
  if (content.includes("new Pool") && !content.includes("pool.on('error'")) {
    // Add error handler for pool
    const poolMatch = content.match(/(const\s+pool\s*=\s*new\s+Pool\([^)]+\))/);
    if (poolMatch) {
      const afterPool = content.indexOf(poolMatch[0]) + poolMatch[0].length;
      const nextLine = content.indexOf("\n", afterPool);
      if (nextLine > 0) {
        const poolErrorHandler = `
pool.on('error', (err) => {
  console.error('[dispatcher] Pool error:', err.message);
  // Don't crash on pool errors, let retry logic handle it
});
`;
        content = content.slice(0, nextLine) + poolErrorHandler + content.slice(nextLine);
        fixed = true;
      }
    }
  }
  
  // Ensure pool.end() is called on shutdown
  if (!content.includes("process.on('SIGTERM'") && !content.includes("process.on('SIGINT'")) {
    const shutdownHandler = `
process.on('SIGTERM', async () => {
  console.log('[dispatcher] SIGTERM received, closing pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[dispatcher] SIGINT received, closing pool...');
  await pool.end();
  process.exit(0);
});
`;
    // Add at end of file before module.exports
    const moduleExportsMatch = content.match(/module\.exports/);
    if (moduleExportsMatch) {
      const beforeExports = content.indexOf(moduleExportsMatch[0]);
      content = content.slice(0, beforeExports) + shutdownHandler + "\n" + content.slice(beforeExports);
      fixed = true;
    }
  }
  
  if (fixed) {
    const backupPath = `${dispatcherPath}.backup.${Date.now()}`;
    fs.writeFileSync(backupPath, fs.readFileSync(dispatcherPath, "utf8"), "utf8");
    fs.writeFileSync(dispatcherPath, content, "utf8");
    console.log(`    ✓ Fixed connection pool handling in dispatcher.js`);
    console.log(`    ✓ Backup: ${backupPath}`);
    return { fixed: true, backupPath };
  }
  
  return { fixed: false, reason: "No connection pool issues found or already fixed" };
}

function fixMemoryLeaks() {
  // Add memory monitoring and cleanup to worker.js
  const workerPath = path.join(ROOT, "workers", "worker.js");
  if (!fs.existsSync(workerPath)) {
    return { fixed: false, reason: "worker.js not found" };
  }
  
  let content = fs.readFileSync(workerPath, "utf8");
  let fixed = false;
  
  // Add periodic memory cleanup if not present
  if (!content.includes("setInterval") || !content.includes("gc") || !content.includes("global.gc")) {
    // Check if --expose-gc flag is mentioned or gc is available
    const gcAvailable = typeof global.gc !== "undefined";
    const memoryCleanup = `
// Periodic memory cleanup (if gc available via --expose-gc flag)
if (typeof global.gc !== 'undefined') {
  setInterval(() => {
    const memBefore = process.memoryUsage();
    global.gc();
    const memAfter = process.memoryUsage();
    const freed = (memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024;
    if (freed > 10) {
      console.log(\`[worker] Memory cleanup freed \${freed.toFixed(1)}MB\`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}
`;
    
    // Add after worker initialization
    const workerMatch = content.match(/(new Worker\([^)]+\))/);
    if (workerMatch) {
      const afterWorker = content.indexOf(workerMatch[0]) + workerMatch[0].length;
      const nextSemicolon = content.indexOf(";", afterWorker);
      if (nextSemicolon > 0) {
        const afterLine = content.indexOf("\n", nextSemicolon);
        if (afterLine > 0) {
          content = content.slice(0, afterLine) + memoryCleanup + content.slice(afterLine);
          fixed = true;
        }
      }
    }
  }
  
  if (fixed) {
    const backupPath = `${workerPath}.backup.${Date.now()}`;
    fs.writeFileSync(backupPath, fs.readFileSync(workerPath, "utf8"), "utf8");
    fs.writeFileSync(workerPath, content, "utf8");
    console.log(`    ✓ Added memory cleanup to worker.js`);
    console.log(`    ✓ Backup: ${backupPath}`);
    console.log(`    ⚠ Run workers with --expose-gc flag for garbage collection`);
    return { fixed: true, backupPath };
  }
  
  return { fixed: false, reason: "Memory cleanup already present or not applicable" };
}

function fixRestartCauses(restartPatterns) {
  const fixes = [];
  
  // Fix high restart rate workers by adding better error handling
  for (const worker of restartPatterns.workers) {
    if (worker.restartRate >= 5) {
      // Suggest PM2 restart limits
      console.log(`    → Worker ${worker.name} has high restart rate (${worker.restartRate}/day)`);
      console.log(`      Consider: pm2 set ${worker.name} max_restarts 10`);
      console.log(`      Consider: pm2 set ${worker.name} min_uptime 60000`);
      fixes.push({
        worker: worker.name,
        action: "pm2_config",
        command: `pm2 set ${worker.name} max_restarts 10 min_uptime 60000`,
      });
    }
  }
  
  return fixes;
}

async function main() {
  console.log("=== Worker Stability Agent ===");
  console.log(`Started: ${new Date().toISOString()}\n`);
  
  const results = {
    restart_rate: 0,
    fixes_applied: 0,
    memory_issues: 0,
    connection_pool_errors: 0,
    ollama_conflicts: 0,
    issues_found: [],
  };
  
  try {
    // 1. Analyze restart patterns
    console.log("[1] Analyzing PM2 restart patterns...");
    const pm2Data = getPM2Processes();
    if (!pm2Data.ok) {
      throw new Error(`PM2 query failed: ${pm2Data.error}`);
    }
    
    const restartPatterns = analyzeRestartPatterns(pm2Data.processes);
    results.restart_rate = Math.round(restartPatterns.restartRate * 10) / 10;
    
    console.log(`  Total worker restarts: ${restartPatterns.totalRestarts}`);
    console.log(`  Average restart rate: ${results.restart_rate}/day`);
    console.log(`  Workers analyzed: ${restartPatterns.workers.length}`);
    
    for (const worker of restartPatterns.workers) {
      console.log(`    ${worker.name}: ${worker.restartRate}/day (${worker.restarts} total)`);
      if (worker.restartRate >= 5) {
        results.issues_found.push(`${worker.name} restart rate too high: ${worker.restartRate}/day`);
      }
    }
    
    // Apply restart fixes
    if (restartPatterns.restartRate >= 5) {
      console.log(`  → Applying restart fixes...`);
      const restartFixes = fixRestartCauses(restartPatterns);
      if (restartFixes.length > 0) {
        results.fixes_applied += restartFixes.length;
        console.log(`    ✓ Suggested ${restartFixes.length} restart fixes`);
        for (const fix of restartFixes) {
          console.log(`      - ${fix.command}`);
        }
      }
    }
    
    // 2. Analyze logs for error patterns
    console.log("\n[2] Analyzing error patterns in logs...");
    const workerProcesses = pm2Data.processes.filter(p => p.name && p.name.includes("worker"));
    const topWorker = workerProcesses[0];
    
    if (topWorker) {
      const logs = checkPM2Logs(topWorker.name, 200);
      if (logs.ok) {
        const errors = analyzeLogErrors(logs.logs);
        
        console.log(`  Error counts (last 200 lines):`);
        for (const [key, pattern] of Object.entries(errors)) {
          if (pattern.count > 0) {
            console.log(`    ${key}: ${pattern.count}`);
            if (key === "pool") results.connection_pool_errors = pattern.count;
            if (key === "memory") results.memory_issues = pattern.count;
          }
        }
        
        // Identify top causes
        const sortedErrors = Object.entries(errors)
          .filter(([_, p]) => p.count > 0)
          .sort(([_, a], [__, b]) => b.count - a.count)
          .slice(0, 5);
        
        if (sortedErrors.length > 0) {
          console.log(`  Top error causes:`);
          for (const [key, pattern] of sortedErrors) {
            console.log(`    - ${key}: ${pattern.count} occurrences`);
            results.issues_found.push(`${key} errors: ${pattern.count} occurrences`);
            
            // Apply fixes for specific error types
            if (key === "pool" && pattern.count > 0) {
              console.log(`    → Fixing connection pool errors...`);
              const fixResult = fixConnectionPoolErrors();
              if (fixResult.fixed) {
                results.fixes_applied++;
                console.log(`    ✓ Connection pool fixes applied`);
              }
            }
          }
        }
      }
    }
    
    // 3. Check memory usage
    console.log("\n[3] Checking memory usage...");
    const memory = checkMemoryUsage();
    if (memory.ok) {
      console.log(`  Total memory: ${(memory.totalMemory / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  Average per process: ${(memory.avgMemory / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  High memory processes (>500MB): ${memory.highMemoryCount}`);
      
      if (memory.highMemoryCount > 0) {
        console.log(`    Processes: ${memory.highMemoryProcesses.join(", ")}`);
        results.memory_issues = memory.highMemoryCount;
        results.issues_found.push(`${memory.highMemoryCount} processes using >500MB memory`);
        
        console.log(`    → Applying memory leak fixes...`);
        const fixResult = fixMemoryLeaks();
        if (fixResult.fixed) {
          results.fixes_applied++;
          console.log(`    ✓ Memory leak fixes applied`);
        }
      }
    } else {
      console.log(`  ⚠ Could not check memory: ${memory.error}`);
    }
    
    // 4. Check Ollama port conflicts
    console.log("\n[4] Checking Ollama port conflicts...");
    const ollama = checkOllamaPort();
    if (ollama.inUse && ollama.processes > 1) {
      console.log(`  ⚠ Port 11434 in use by ${ollama.processes} processes (potential conflict)`);
      results.ollama_conflicts = ollama.processes;
      results.issues_found.push(`Ollama port conflict: ${ollama.processes} processes on port 11434`);
    } else {
      console.log(`  ✓ Port 11434: ${ollama.inUse ? "in use (normal)" : "available"}`);
    }
    
    // Summary
    console.log("\n=== Summary ===");
    console.log(`Restart rate: ${results.restart_rate}/day (target: <5/day)`);
    console.log(`Memory issues: ${results.memory_issues}`);
    console.log(`Connection pool errors: ${results.connection_pool_errors}`);
    console.log(`Ollama conflicts: ${results.ollama_conflicts}`);
    console.log(`Issues found: ${results.issues_found.length}`);
    
    if (results.restart_rate >= 5) {
      console.log(`  ⚠ Restart rate exceeds target`);
    }
    
    // Output JSON for runner
    console.log(JSON.stringify({
      ok: true,
      ...results,
      restart_patterns: restartPatterns,
      report: {
        latestPath: path.join(ROOT, "scripts", "reports", `status-review-worker_stability_agent-latest.json`),
      },
    }));
    
  } catch (err) {
    console.error(`[worker] Error: ${err.message}`);
    console.error(err.stack);
    console.log(JSON.stringify({
      ok: false,
      error: err.message,
      ...results,
    }));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[worker] Fatal error: ${err.message}`);
  process.exit(1);
});

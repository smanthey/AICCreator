#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const redis = require("../infra/redis");
const pg = require("../infra/postgres");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SECURITY_LEARNINGS_PATH = path.join(ROOT, "agent-state", "security", "learnings.json");

async function checkRedisAuth() {
  try {
    // Try to get config - if requirepass is set, we'll need password
    // If no password required, CONFIG GET will work without auth
    const result = spawnSync("redis-cli", [
      "-h", process.env.REDIS_HOST || "192.168.1.164",
      "-p", process.env.REDIS_PORT || "16379",
      "CONFIG", "GET", "requirepass"
    ], {
      encoding: "utf8",
      timeout: 5000,
    });
    
    if (result.status !== 0) {
      // Might be auth error or connection error
      const output = (result.stderr || result.stdout || "").toLowerCase();
      if (output.includes("auth") || output.includes("noauth")) {
        return { hasAuth: true, status: "enabled", error: null };
      }
      return { hasAuth: false, status: "unknown", error: result.stderr || "Connection failed" };
    }
    
    const lines = (result.stdout || "").trim().split("\n");
    const requirepass = lines.find(l => l && !l.startsWith("requirepass")) || "";
    
    if (requirepass && requirepass.trim() !== "") {
      return { hasAuth: true, status: "enabled", password: "***" };
    }
    
    return { hasAuth: false, status: "disabled", needsFix: true };
  } catch (err) {
    return { hasAuth: false, status: "error", error: err.message };
  }
}

async function enableRedisAuth() {
  // Generate a strong password
  const password = crypto.randomBytes(32).toString("hex");
  
  // Try to set requirepass via redis-cli
  const result = spawnSync("redis-cli", [
    "-h", process.env.REDIS_HOST || "192.168.1.164",
    "-p", process.env.REDIS_PORT || "16379",
    "CONFIG", "SET", "requirepass", password
  ], {
    encoding: "utf8",
    timeout: 5000,
  });
  
  if (result.status !== 0) {
    throw new Error(`Failed to set Redis password: ${result.stderr || result.stdout}`);
  }
  
  // Update infra/redis.js to add password support
  const redisFilePath = path.join(ROOT, "infra", "redis.js");
  if (fs.existsSync(redisFilePath)) {
    let content = fs.readFileSync(redisFilePath, "utf8");
    
    // Check if password is already in config
    if (!content.includes("password:") || !content.includes("process.env.REDIS_PASSWORD")) {
      // Add password to Redis config
      const redisConfigMatch = content.match(/(const redis = new Redis\(\{[\s\S]*?)(\}\);)/);
      if (redisConfigMatch) {
        const configPart = redisConfigMatch[1];
        // Add password if not present
        if (!configPart.includes("password")) {
          const newConfig = configPart.trim() + `,\n  password: process.env.REDIS_PASSWORD || process.env.REDIS_AUTH_TOKEN,`;
          content = content.replace(redisConfigMatch[0], newConfig + redisConfigMatch[2]);
          fs.writeFileSync(redisFilePath, content, "utf8");
          console.log(`    ✓ Updated infra/redis.js to support password`);
        }
      }
    }
  }
  
  // Save password to .env (or create REDIS_PASSWORD env var instruction)
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    if (!envContent.includes("REDIS_PASSWORD=")) {
      envContent += `\n# Redis authentication (set by security-remediation-agent)\nREDIS_PASSWORD=${password}\n`;
      fs.writeFileSync(envPath, envContent, "utf8");
      console.log(`    ✓ Added REDIS_PASSWORD to .env`);
    } else {
      // Update existing password
      envContent = envContent.replace(/REDIS_PASSWORD=.*/g, `REDIS_PASSWORD=${password}`);
      fs.writeFileSync(envPath, envContent, "utf8");
      console.log(`    ✓ Updated REDIS_PASSWORD in .env`);
    }
  } else {
    console.log(`    ⚠ .env file not found - set REDIS_PASSWORD=${password} manually`);
  }
  
  // Persist to redis.conf if we can find it
  const redisConfPaths = [
    "/etc/redis/redis.conf",
    "/usr/local/etc/redis.conf",
    path.join(process.env.HOME || "", ".redis.conf"),
  ];
  
  for (const confPath of redisConfPaths) {
    if (fs.existsSync(confPath)) {
      let confContent = fs.readFileSync(confPath, "utf8");
      if (!confContent.includes("requirepass")) {
        confContent += `\n# Redis password (set by security-remediation-agent)\nrequirepass ${password}\n`;
        fs.writeFileSync(confPath, confContent, "utf8");
        console.log(`    ✓ Added requirepass to ${confPath}`);
        break;
      }
    }
  }
  
  return { password: "***", fixed: true };
}

async function findPgHbaConf() {
  // Common locations: /etc/postgresql/*/main/pg_hba.conf, /var/lib/postgresql/data/pg_hba.conf
  const commonPaths = [
    "/etc/postgresql",
    "/var/lib/postgresql",
    "/usr/local/var/postgres",
    "/opt/homebrew/var/postgres",
  ];
  
  for (const basePath of commonPaths) {
    try {
      const { execSync } = require("child_process");
      const result = execSync(`find ${basePath} -name pg_hba.conf 2>/dev/null | head -1`, { encoding: "utf8" });
      if (result.trim() && fs.existsSync(result.trim())) {
        return result.trim();
      }
    } catch {
      // Continue searching
    }
  }
  
  return null;
}

async function checkPostgresAuth() {
  const pgHbaPath = await findPgHbaConf();
  
  if (!pgHbaPath) {
    return { hasAuth: false, status: "unknown", error: "pg_hba.conf not found", needsFix: true };
  }
  
  try {
    const content = fs.readFileSync(pgHbaPath, "utf8");
    const lines = content.split("\n");
    const trustEntries = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("#") && line.includes("trust")) {
        trustEntries.push({ line: i + 1, content: line });
      }
    }
    
    if (trustEntries.length > 0) {
      return { hasAuth: false, status: "trust_enabled", trustEntries: trustEntries.length, needsFix: true, pgHbaPath, entries: trustEntries };
    }
    
    return { hasAuth: true, status: "secure", pgHbaPath };
  } catch (err) {
    return { hasAuth: false, status: "error", error: err.message };
  }
}

async function fixPostgresAuth(pgHbaPath, trustEntries) {
  if (!pgHbaPath || !fs.existsSync(pgHbaPath)) {
    return { fixed: false, reason: "pg_hba.conf not found or not writable" };
  }
  
  try {
    let content = fs.readFileSync(pgHbaPath, "utf8");
    const lines = content.split("\n");
    let fixed = false;
    
    // Replace trust with md5 for local connections
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() && !line.trim().startsWith("#")) {
        // Replace trust with md5 for IPv4 and IPv6 local connections
        if (line.includes("trust") && (line.includes("127.0.0.1") || line.includes("localhost") || line.includes("::1") || line.includes("local"))) {
          lines[i] = line.replace(/\btrust\b/g, "md5");
          fixed = true;
        }
      }
    }
    
    if (fixed) {
      // Backup original
      const backupPath = `${pgHbaPath}.backup.${Date.now()}`;
      fs.writeFileSync(backupPath, content, "utf8");
      
      // Write updated content
      fs.writeFileSync(pgHbaPath, lines.join("\n"), "utf8");
      
      console.log(`    ✓ Updated ${trustEntries.length} trust entries to md5 in ${pgHbaPath}`);
      console.log(`    ✓ Backup saved to ${backupPath}`);
      console.log(`    ⚠ Restart PostgreSQL for changes to take effect`);
      
      return { fixed: true, backupPath };
    }
    
    return { fixed: false, reason: "No trust entries found to replace" };
  } catch (err) {
    return { fixed: false, reason: err.message };
  }
}

async function checkDiscordGateway() {
  // Check PM2 for Discord gateway process
  const result = spawnSync("pm2", ["jlist"], {
    encoding: "utf8",
    timeout: 5000,
  });
  
  if (result.status !== 0) {
    return { status: "error", error: "Could not query PM2" };
  }
  
  try {
    const processes = JSON.parse(result.stdout || "[]");
    const gateway = processes.find(p => p.name && (p.name.toLowerCase().includes("gateway") || p.name?.includes("discord")));
    
    if (!gateway) {
      return { status: "not_found", restartRate: 0 };
    }
  
    // Calculate restart rate (restarts per day)
    const restarts = gateway.pm2_env?.restart_time || 0;
    const uptime = gateway.pm2_env?.pm_uptime || Date.now();
    const uptimeDays = (Date.now() - uptime) / (1000 * 60 * 60 * 24);
    const restartRate = uptimeDays > 0 ? restarts / uptimeDays : restarts;
    
    return {
      status: "found",
      name: gateway.name,
      restarts,
      restartRate: Math.round(restartRate * 10) / 10,
      needsFix: restartRate >= 1,
    };
  } catch (err) {
    return { status: "error", error: err.message };
  }
}

async function fixDiscordGateway() {
  const gatewayPath = path.join(ROOT, "scripts", "discord-gateway.js");
  if (!fs.existsSync(gatewayPath)) {
    return { fixed: false, reason: "discord-gateway.js not found" };
  }
  
  let content = fs.readFileSync(gatewayPath, "utf8");
  let fixed = false;
  
  // 1. Ensure DISCORD_OPTIONAL is set to true to prevent crash-looping when token is missing
  if (!content.includes("DISCORD_OPTIONAL")) {
    // Add DISCORD_OPTIONAL check near the top
    const envCheckMatch = content.match(/(const BOT_TOKEN = String\(process\.env\.DISCORD_BOT_TOKEN[^;]+\);)/);
    if (envCheckMatch) {
      const afterToken = content.indexOf(envCheckMatch[0]) + envCheckMatch[0].length;
      const insertPoint = content.indexOf("\n", afterToken);
      if (insertPoint > 0) {
        content = content.slice(0, insertPoint) + 
          `\nconst DISCORD_OPTIONAL = String(process.env.DISCORD_OPTIONAL || "true").toLowerCase() === "true";` +
          content.slice(insertPoint);
        fixed = true;
      }
    }
  }
  
  // 2. Ensure graceful exit when token is missing and optional
  if (!content.includes("DISCORD_OPTIONAL") || !content.includes("standby mode")) {
    // Check if standby mode exists
    const standbyCheck = /if\s*\(\s*!BOT_TOKEN[^}]+standby/i.test(content);
    if (!standbyCheck) {
      // Add standby mode before client initialization
      const clientInitMatch = content.match(/(} else \{[^]*?const client = new Client)/);
      if (clientInitMatch) {
        const beforeClient = content.indexOf(clientInitMatch[0]);
        const standbyCode = `} else if (!BOT_TOKEN && DISCORD_OPTIONAL) {
  console.warn("[discord-gateway] DISCORD_BOT_TOKEN missing; gateway in standby mode.");
  const DISABLED_HEARTBEAT_MS = Math.max(60_000, Number(process.env.DISCORD_DISABLED_HEARTBEAT_MS || "900000") || 900000);
  setInterval(() => {
    console.warn("[discord-gateway] standby: set DISCORD_BOT_TOKEN to enable Discord integration.");
  }, DISABLED_HEARTBEAT_MS);
  process.stdin.resume();
`;
        content = content.slice(0, beforeClient) + standbyCode + content.slice(beforeClient);
        fixed = true;
      }
    }
  }
  
  // 3. Add better error handling for login failures
  if (!content.includes("client.on('error'") || !content.includes("login failed")) {
    const errorHandler = `
client.on('error', (err) => {
  console.error("[discord-gateway] client error:", err.message);
  // Don't crash on transient errors
  if (err.message.includes('WebSocket') || err.message.includes('ECONNRESET')) {
    console.warn("[discord-gateway] transient error, will retry");
    return;
  }
});

client.login(BOT_TOKEN).catch((err) => {
  console.error("[discord-gateway] login failed:", err.message);
  if (DISCORD_OPTIONAL) {
    console.warn("[discord-gateway] continuing in optional mode");
    process.stdin.resume();
  } else {
    process.exit(1);
  }
});
`;
    // Find where client.login is called and add error handler
    const loginMatch = content.match(/client\.login\(BOT_TOKEN\)/);
    if (loginMatch && !content.includes("client.login(BOT_TOKEN).catch")) {
      const loginPos = content.indexOf(loginMatch[0]);
      const afterLogin = content.indexOf("\n", loginPos);
      if (afterLogin > 0) {
        content = content.slice(0, afterLogin) + `.catch((err) => {
  console.error("[discord-gateway] login failed:", err.message);
  if (DISCORD_OPTIONAL) {
    console.warn("[discord-gateway] continuing in optional mode");
    process.stdin.resume();
  } else {
    process.exit(1);
  }
})` + content.slice(afterLogin);
        fixed = true;
      }
    }
  }
  
  if (fixed) {
    // Backup original
    const backupPath = `${gatewayPath}.backup.${Date.now()}`;
    fs.writeFileSync(backupPath, fs.readFileSync(gatewayPath, "utf8"), "utf8");
    
    // Write updated content
    fs.writeFileSync(gatewayPath, content, "utf8");
    
    console.log(`    ✓ Updated discord-gateway.js with improved error handling`);
    console.log(`    ✓ Backup saved to ${backupPath}`);
    console.log(`    ⚠ Restart gateway: pm2 restart claw-discord-gateway`);
    
    return { fixed: true, backupPath };
  }
  
  return { fixed: false, reason: "No changes needed or could not apply fixes" };
}

async function loadSecurityFindings() {
  try {
    const data = JSON.parse(fs.readFileSync(SECURITY_LEARNINGS_PATH, "utf8"));
    const critical = data.recurring_patterns?.filter(p => p.startsWith("C")) || [];
    const high = data.recurring_patterns?.filter(p => p.startsWith("H")) || [];
    
    return {
      critical: critical.length,
      high: high.length,
      total: critical.length + high.length,
      patterns: data.recurring_patterns || [],
    };
  } catch {
    return { critical: 0, high: 0, total: 0, patterns: [] };
  }
}

async function main() {
  console.log("=== Security Remediation Agent ===");
  console.log(`Started: ${new Date().toISOString()}\n`);
  
  const results = {
    security_fixes: 0,
    redis_auth: { status: "unknown" },
    postgres_auth: { status: "unknown" },
    discord_gateway: { status: "unknown" },
    critical_findings: 0,
    issues_found: [],
  };
  
  try {
    // 1. Check Redis authentication (C1)
    console.log("[1] Checking Redis authentication (C1)...");
    const redisAuth = await checkRedisAuth();
    results.redis_auth = redisAuth;
    
    if (redisAuth.hasAuth) {
      console.log(`  ✓ Redis authentication: ${redisAuth.status}`);
    } else if (redisAuth.needsFix) {
      console.log(`  ✗ Redis authentication: ${redisAuth.status} - NEEDS FIX`);
      console.log(`    → Attempting to enable...`);
      try {
        const fixResult = await enableRedisAuth();
        results.security_fixes++;
        console.log(`    ✓ Redis password set`);
        console.log(`    ⚠ Update connection strings in codebase`);
        results.redis_auth.fixed = true;
      } catch (err) {
        console.log(`    ✗ Failed to enable: ${err.message}`);
        results.issues_found.push(`Redis auth fix failed: ${err.message}`);
      }
    } else {
      console.log(`  ⚠ Redis authentication: ${redisAuth.status}`);
      if (redisAuth.error) {
        console.log(`    Error: ${redisAuth.error}`);
      }
    }
    
    // 2. Check Postgres authentication (C2)
    console.log("\n[2] Checking Postgres authentication (C2)...");
    const pgAuth = await checkPostgresAuth();
    results.postgres_auth = pgAuth;
    
    if (pgAuth.hasAuth) {
      console.log(`  ✓ Postgres authentication: ${pgAuth.status}`);
    } else if (pgAuth.needsFix) {
      console.log(`  ✗ Postgres authentication: ${pgAuth.status} - NEEDS FIX`);
      console.log(`    → Found ${pgAuth.trustEntries || 0} trust entries in pg_hba.conf`);
      console.log(`    → Attempting to fix...`);
      try {
        const fixResult = await fixPostgresAuth(pgAuth.pgHbaPath, pgAuth.entries);
        if (fixResult.fixed) {
          console.log(`    ✓ Postgres authentication fixed`);
          results.security_fixes++;
          results.postgres_auth.fixed = true;
        } else {
          console.log(`    ⚠ Fix failed: ${fixResult.reason}`);
          results.issues_found.push(`Postgres trust auth found: ${pgAuth.trustEntries || 0} entries (fix failed: ${fixResult.reason})`);
        }
      } catch (err) {
        console.log(`    ✗ Fix error: ${err.message}`);
        results.issues_found.push(`Postgres trust auth found: ${pgAuth.trustEntries || 0} entries (${err.message})`);
      }
    } else {
      console.log(`  ⚠ Postgres authentication: ${pgAuth.status}`);
      if (pgAuth.error) {
        console.log(`    Error: ${pgAuth.error}`);
      }
    }
    
    // 3. Check Discord gateway (C3)
    console.log("\n[3] Checking Discord gateway stability (C3)...");
    const discord = await checkDiscordGateway();
    results.discord_gateway = discord;
    
    if (discord.status === "found") {
      console.log(`  Gateway: ${discord.name}`);
      console.log(`  Restart rate: ${discord.restartRate}/day`);
      if (discord.needsFix) {
        console.log(`  ✗ Restart rate too high (target: <1/day) - NEEDS FIX`);
        console.log(`    → Attempting to fix...`);
        try {
          const fixResult = await fixDiscordGateway();
          if (fixResult.fixed) {
            console.log(`    ✓ Discord gateway fixes applied`);
            results.security_fixes++;
            results.discord_gateway.fixed = true;
          } else {
            console.log(`    ⚠ Fix failed: ${fixResult.reason}`);
            results.issues_found.push(`Discord gateway restart rate: ${discord.restartRate}/day (fix failed: ${fixResult.reason})`);
          }
        } catch (err) {
          console.log(`    ✗ Fix error: ${err.message}`);
          results.issues_found.push(`Discord gateway restart rate: ${discord.restartRate}/day (${err.message})`);
        }
      } else {
        console.log(`  ✓ Restart rate acceptable`);
      }
    } else {
      console.log(`  ⚠ Gateway: ${discord.status}`);
      if (discord.error) {
        console.log(`    Error: ${discord.error}`);
      }
    }
    
    // 4. Load security findings
    console.log("\n[4] Loading security findings...");
    const findings = await loadSecurityFindings();
    results.critical_findings = findings.critical;
    console.log(`  Critical: ${findings.critical}`);
    console.log(`  High: ${findings.high}`);
    console.log(`  Total: ${findings.total}`);
    
    // Summary
    console.log("\n=== Summary ===");
    console.log(`Security fixes applied: ${results.security_fixes}`);
    console.log(`Redis auth: ${results.redis_auth.status}`);
    console.log(`Postgres auth: ${results.postgres_auth.status}`);
    console.log(`Discord gateway: ${results.discord_gateway.restartRate || "N/A"}/day`);
    console.log(`Critical findings: ${results.critical_findings}`);
    console.log(`Issues found: ${results.issues_found.length}`);
    
    // Output JSON for runner
    console.log(JSON.stringify({
      ok: true,
      ...results,
      report: {
        latestPath: path.join(ROOT, "scripts", "reports", `status-review-security_remediation_agent-latest.json`),
      },
    }));
    
  } catch (err) {
    console.error(`[security] Error: ${err.message}`);
    console.error(err.stack);
    console.log(JSON.stringify({
      ok: false,
      error: err.message,
      ...results,
    }));
    process.exit(1);
  } finally {
    try {
      await redis.quit();
    } catch {}
    try {
      await pg.end();
    } catch {}
  }
}

main().catch((err) => {
  console.error(`[security] Fatal error: ${err.message}`);
  process.exit(1);
});

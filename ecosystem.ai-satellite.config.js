"use strict";

// Minimal PM2 profile for secondary AI devices (M1 laptop/desktop).
// This keeps satellites focused on Ollama + ai_worker only.

const os = require("os");
const REPO = __dirname;
const HOSTNAME = process.env.SATELLITE_NAME || "claw-ai-satellite";

module.exports = {
  apps: [
    {
      // Ollama: use autorestart: false to stop crash loop when ollama is not installed or port 11434 fails.
      // If already in loop: pm2 delete m1-laptop-ollama (or ${HOSTNAME}-ollama). Start only on hosts with Ollama.
      name: `${HOSTNAME}-ollama`,
      script: "ollama",
      args: "serve",
      cwd: REPO,
      watch: false,
      autorestart: false,
      max_restarts: 2,
      restart_delay: 10000,
      env: {
        NODE_ENV: "production",
        OLLAMA_HOST: process.env.OLLAMA_HOST || "127.0.0.1:11434",
        OLLAMA_KEEP_ALIVE: "24h",
        OLLAMA_NUM_PARALLEL: "2",
        PATH: "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: `${HOSTNAME}-worker-ai`,
      script: "workers/worker.js",
      cwd: REPO,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "768M",
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        NODE_ROLE: "ai_worker",
        REDIS_HOST: process.env.REDIS_HOST || "192.168.1.164",
        REDIS_PORT: process.env.REDIS_PORT || "16379",
        OLLAMA_HOSTS: process.env.OLLAMA_HOSTS || process.env.MODEL_FLEET_OLLAMA_HOSTS || "http://127.0.0.1:11434",
        OLLAMA_REMOTE_FIRST: process.env.OLLAMA_REMOTE_FIRST || "false",
        WORKER_TAGS: "ai,qa",
        WORKER_ENFORCE_ROLE_TAG_POLICY: "true",
        WORKER_LOCK_DURATION_MS: "180000",
        WORKER_STALLED_INTERVAL_MS: "60000",
        MODEL_ROUTING_EXTRA_PROVIDERS: "deepseek,gemini",
        MODEL_ROUTING_ANTHROPIC_LAST: "true",
        ANTHROPIC_ALLOWED: "false",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: `${HOSTNAME}-ollama-maint`,
      script: "scripts/ollama-maintenance.js",
      cwd: REPO,
      watch: false,
      autorestart: false,
      cron_restart: "*/10 * * * *",
      env: {
        NODE_ENV: "production",
        OLLAMA_MAINT_TIMEOUT_MS: "20000",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: `${HOSTNAME}-system-cleanup`,
      script: "scripts/system-cleanup.js",
      cwd: REPO,
      watch: false,
      autorestart: false,
      cron_restart: "20 */6 * * *",
      env: {
        NODE_ENV: "production",
        SYSTEM_CLEANUP_RETENTION_DAYS: "10",
        SYSTEM_CLEANUP_REPORT_RETENTION_DAYS: "5",
        SYSTEM_CLEANUP_PM2_LOG_MAX_MB: "120",
        SYSTEM_CLEANUP_PM2_TRUNCATE_MB: "15",
        SYSTEM_CLEANUP_PM2_RESTART_HIGH_MEM: "true",
        SYSTEM_CLEANUP_PM2_RESTART_MB: "900",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: `${HOSTNAME}-backup-to-nas`,
      script: "scripts/backup-to-nas.js",
      cwd: REPO,
      watch: false,
      autorestart: false,
      cron_restart: "25 */2 * * *",
      env: {
        NODE_ENV: "production",
        BACKUP_DEVICE_NAME: HOSTNAME,
        NAS_BACKUP_ROOT: "/Volumes/home/Storage/_claw_backup",
        BACKUP_SOURCE_ROOTS: `${os.homedir()}/Downloads|${os.homedir()}/Dropbox`,
        BACKUP_MAX_FILES: "2500",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};

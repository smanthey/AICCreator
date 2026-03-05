"use strict";

// Dedicated PM2 profile for always-on i7 desktop.
// Focus: queue throughput + deterministic/IO-heavy tasks + periodic cleanup.

const REPO = __dirname;
const HOSTNAME = process.env.SATELLITE_NAME || "i7-desktop";
const os = require("os");

module.exports = {
  apps: [
    {
      name: `${HOSTNAME}-worker-nas`,
      script: "workers/worker.js",
      cwd: REPO,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "1200M",
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        NODE_ROLE: "nas_worker",
        REDIS_HOST: process.env.REDIS_HOST || "192.168.1.164",
        REDIS_PORT: process.env.REDIS_PORT || "16379",
        OLLAMA_HOSTS: process.env.OLLAMA_HOSTS || process.env.MODEL_FLEET_OLLAMA_HOSTS || "http://127.0.0.1:11434",
        OLLAMA_REMOTE_FIRST: process.env.OLLAMA_REMOTE_FIRST || "true",
        WORKER_TAGS: "infra,deterministic,io_heavy,cpu_heavy",
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
      name: `${HOSTNAME}-worker-io`,
      script: "workers/worker.js",
      cwd: REPO,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "1200M",
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        NODE_ROLE: "worker",
        REDIS_HOST: process.env.REDIS_HOST || "192.168.1.164",
        REDIS_PORT: process.env.REDIS_PORT || "16379",
        OLLAMA_HOSTS: process.env.OLLAMA_HOSTS || process.env.MODEL_FLEET_OLLAMA_HOSTS || "http://127.0.0.1:11434",
        OLLAMA_REMOTE_FIRST: process.env.OLLAMA_REMOTE_FIRST || "true",
        WORKER_TAGS: "io_light",
        WORKER_LOCK_DURATION_MS: "180000",
        WORKER_STALLED_INTERVAL_MS: "60000",
        MODEL_ROUTING_EXTRA_PROVIDERS: "deepseek,gemini",
        MODEL_ROUTING_ANTHROPIC_LAST: "true",
        ANTHROPIC_ALLOWED: "false",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: `${HOSTNAME}-system-cleanup`,
      script: "scripts/system-cleanup.js",
      cwd: REPO,
      watch: false,
      autorestart: false,
      cron_restart: "10 */6 * * *",
      env: {
        NODE_ENV: "production",
        SYSTEM_CLEANUP_RETENTION_DAYS: "21",
        SYSTEM_CLEANUP_REPORT_RETENTION_DAYS: "10",
        SYSTEM_CLEANUP_PM2_LOG_MAX_MB: "200",
        SYSTEM_CLEANUP_PM2_TRUNCATE_MB: "30",
        SYSTEM_CLEANUP_PM2_RESTART_HIGH_MEM: "true",
        SYSTEM_CLEANUP_PM2_RESTART_MB: "1200",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: `${HOSTNAME}-backup-to-nas`,
      script: "scripts/backup-to-nas.js",
      cwd: REPO,
      watch: false,
      autorestart: false,
      cron_restart: "12 */2 * * *",
      env: {
        NODE_ENV: "production",
        BACKUP_DEVICE_NAME: HOSTNAME,
        NAS_BACKUP_ROOT: "/Volumes/home/Storage/_claw_backup",
        BACKUP_SOURCE_ROOTS: `${os.homedir()}/Downloads|${os.homedir()}/Dropbox|${os.homedir()}/claw-repos`,
        BACKUP_MAX_FILES: "5000",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};

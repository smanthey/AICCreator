// ecosystem.config.js
// pm2 config for M1 Desktop (Control Plane)
//
// Setup (one-time):
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup   ← follow the printed command to survive reboots
//
// Commands:
//   pm2 status        — see all processes
//   pm2 logs          — tail all logs
//   pm2 logs claw-gateway
//   pm2 restart all
//   pm2 stop all

module.exports = {
  apps: [
    // ── jcodemunch REST API — symbol search for Ollama/DeepSeek agents ──
    // Reads ~/.code-index/ JSON indexes, exposes HTTP on port 4055.
    // Any LLM or OpenClaw agent can search 50+ repos without MCP.
    {
      name:          "jcodemunch-api",
      script:        "scripts/jcodemunch-api.js",
      cwd:           __dirname,
      watch:         false,
      autorestart:   true,
      max_restarts:  10,
      restart_delay: 3000,
      min_uptime:    "5s",
      env: {
        NODE_ENV:              "production",
        JCODEMUNCH_API_PORT:   "4055",
        JCODEMUNCH_API_HOST:   process.env.JCODEMUNCH_API_HOST || "127.0.0.1",
        JCODEMUNCH_ALLOWED_ORIGINS:
          process.env.JCODEMUNCH_ALLOWED_ORIGINS || "http://localhost:4051,http://127.0.0.1:4051",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file:  "logs/jcodemunch-api-error.log",
      out_file:    "logs/jcodemunch-api-out.log",
      merge_logs:  true
    },

    // ── Worker: handles all local task types including repo_autofix ──
    // Added io_heavy,infra,deterministic so repo_autofix tasks are processed
    // instead of stalling in DISPATCHED and triggering quarantine spam loops.
    {
      name:          "claw-worker",
      script:        "workers/worker.js",
      cwd:           __dirname,
      watch:         false,
      autorestart:   true,
      max_restarts:  10,
      restart_delay: 5000,
      kill_timeout:  8000,
      min_uptime:    "10s",
      env: {
        NODE_ENV:    "production",
        NODE_ROLE:   "worker",
        WORKER_TAGS: "io_light,io_heavy,infra,deterministic",
        POSTGRES_HOST: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST || "192.168.1.164",
        POSTGRES_PORT: process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432",
        POSTGRES_DB: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
        POSTGRES_USER: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
        REDIS_HOST: process.env.CLAW_REDIS_HOST || "192.168.1.164",
        REDIS_PORT: process.env.CLAW_REDIS_PORT || "16379",
        OLLAMA_HOSTS: process.env.OLLAMA_HOSTS || process.env.MODEL_FLEET_OLLAMA_HOSTS || "http://127.0.0.1:11434",
        OLLAMA_REMOTE_FIRST: process.env.OLLAMA_REMOTE_FIRST || "false",
        MODEL_ROUTING_EXTRA_PROVIDERS: "deepseek,gemini",
        MODEL_ROUTING_ANTHROPIC_LAST: "true",
        ANTHROPIC_ALLOWED: "false"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file:  "logs/worker-error.log",
      out_file:    "logs/worker-out.log",
      merge_logs:  true
    }
  ]
};

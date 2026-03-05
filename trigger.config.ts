// trigger.config.ts — Trigger.dev v4 configuration for claw-architect
// ─────────────────────────────────────────────────────────────────────────────
// Trigger.dev runs long AI tasks durably with checkpoint-resume.
// Use for content_draft_generate and content_draft_score — tasks that call
// LLMs and may take 30s-5min, need retries on failure, and benefit from
// automatic queue management without babysitting BullMQ.
//
// Setup:
//   1. npm install @trigger.dev/sdk@^4.4.1
//   2. Set TRIGGER_SECRET_KEY in .env (from https://cloud.trigger.dev)
//   3. npx trigger.dev@latest dev   (local dev — watches trigger-tasks/)
//   4. npx trigger.dev@latest deploy (production)
//
// Docs: https://trigger.dev/docs

import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_macdwmzdozotlbknytpp",
  runtime: "node",
  logLevel: "info",

  // Required in v4 — global default max duration for all tasks (seconds)
  // Individual tasks override this with their own maxDuration
  maxDuration: 300,

  // Task directories — Trigger.dev scans these for task definitions
  dirs: ["trigger-tasks"],

  // Retry defaults (overridable per-task)
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      randomize: true,
    },
  },

  // Machine preset for all tasks
  machine: {
    preset: "small-1x",   // 0.5 vCPU, 500MB RAM — adequate for LLM API calls
  },

  // Tell esbuild not to try to bundle these channel adapter modules at build
  // time — they're resolved at runtime on the Trigger.dev worker, where the
  // full claw-architect node_modules tree is available.
  build: {
    external: [
      // Channel adapters referenced dynamically in scripts/content-publish.js
      "./maileroo",
      "./telnyx-sms",
      "@octokit/rest",
      // Keep heavy runtime deps external to keep bundles small
      "pg",
      "dotenv",
    ],
  },
});

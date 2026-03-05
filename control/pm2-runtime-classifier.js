"use strict";

const path = require("path");

const REPO = path.join(__dirname, "..");
const CONFIG_FILES = [
  "ecosystem.config.js",
  "ecosystem.background.config.js",
  "ecosystem.ai-satellite.config.js",
  "ecosystem.i7-satellite.config.js",
];

function safeRequire(file) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(file);
  } catch {
    return null;
  }
}

function classifyFromConfig(app) {
  if (!app || typeof app !== "object") return "unknown";
  if (app.cron_restart) return "scheduled";
  if (app.autorestart === false) return "one_shot";
  return "persistent";
}

function loadConfiguredAppMeta() {
  const byName = new Map();
  for (const rel of CONFIG_FILES) {
    const config = safeRequire(path.join(REPO, rel));
    const apps = Array.isArray(config?.apps) ? config.apps : [];
    for (const app of apps) {
      const name = String(app?.name || "");
      if (!name) continue;
      const existing = byName.get(name) || {};
      byName.set(name, {
        name,
        runtime_class: classifyFromConfig(app),
        cron_restart: app?.cron_restart || existing.cron_restart || null,
        autorestart: app?.autorestart !== false,
        script: app?.script || existing.script || null,
      });
    }
  }
  return byName;
}

function annotatePm2Process(proc, byName) {
  const name = String(proc?.name || "");
  const env = proc?.pm2_env || {};
  const meta = byName.get(name);
  const runtimeClassFromEnv = env.cron_restart
    ? "scheduled"
    : env.autorestart === false
      ? "one_shot"
      : "persistent";
  return {
    runtime_class: meta?.runtime_class || runtimeClassFromEnv,
    cron_restart: meta?.cron_restart || env.cron_restart || null,
    autorestart: meta ? !!meta.autorestart : (typeof env.autorestart === "boolean" ? env.autorestart : null),
    script: meta?.script || env.pm_exec_path || null,
  };
}

module.exports = {
  classifyFromConfig,
  loadConfiguredAppMeta,
  annotatePm2Process,
};

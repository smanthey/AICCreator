#!/usr/bin/env node
"use strict";
/**
 * OpenClawless bootstrap
 * ---------------------
 * Prepares a minimum viable local setup when OpenClaw is not installed.
 * The intent is "press play, get useful output," not "learn the whole stack first."
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");
const reportsDir = path.join(root, "reports");
const ytUrlsPath = path.join(root, "data", "youtube-urls.txt");

function hasBinary(name) {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function upsertEnv(text, key, value) {
  const lines = String(text || "").split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (k !== key) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) updated.push(`${key}=${value}`);
  return `${updated.join("\n").replace(/\n+$/g, "")}\n`;
}

if (!fs.existsSync(envPath)) {
  if (!fs.existsSync(envExamplePath)) {
    throw new Error("Missing .env.example");
  }
  fs.copyFileSync(envExamplePath, envPath);
}

let envText = readText(envPath);
const generatedApiKey = `openclawless_${crypto.randomBytes(16).toString("hex")}`;
// Keep this mode explicit so operators can reason about behavior from env alone.
envText = upsertEnv(envText, "OPENCLAWLESS_MODE", "true");
if (!/^[^#\n]*BUILDERBOT_API_KEY=.+/m.test(envText) || /BUILDERBOT_API_KEY=\s*(change-me)?\s*$/m.test(envText)) {
  envText = upsertEnv(envText, "BUILDERBOT_API_KEY", generatedApiKey);
}
fs.writeFileSync(envPath, envText);

fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(path.dirname(ytUrlsPath), { recursive: true });

if (!fs.existsSync(ytUrlsPath)) {
  fs.writeFileSync(
    ytUrlsPath,
    [
      "# One YouTube URL per line",
      "# Example:",
      "# https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "",
    ].join("\n")
  );
}

const ffmpeg = hasBinary("ffmpeg");
const ytdlp = hasBinary("yt-dlp");

console.log("Bootstrap complete (openclawless mode).");
console.log(`- .env ready: ${envPath}`);
console.log(`- URLs template: ${ytUrlsPath}`);
console.log(`- reports dir: ${reportsDir}`);
console.log(`- ffmpeg: ${ffmpeg ? "found" : "missing"}`);
console.log(`- yt-dlp: ${ytdlp ? "found" : "missing"}`);

if (!ffmpeg || !ytdlp) {
  console.log("\nInstall missing tools for full transcript+visual indexing:");
  console.log("- macOS (Homebrew): brew install ffmpeg yt-dlp");
  console.log("- Ubuntu/Debian: sudo apt-get install -y ffmpeg yt-dlp");
}

console.log("\nNext steps:");
console.log("1) Add URLs in data/youtube-urls.txt");
console.log("2) Run: npm run youtube:index:auto");
console.log("3) Run: npm run oss:dashboard:benchmark");

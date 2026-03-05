#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");

function getArg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function safeSlug(v) {
  return String(v || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown";
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function usageAndExit() {
  console.error("Usage: node scripts/web-fallback-extract.js --service <name> --url <https://...> [--selector '.css'] [--screenshot]");
  process.exit(1);
}

async function main() {
  const service = getArg("--service");
  const url = getArg("--url");
  const selector = getArg("--selector", "body");
  const withScreenshot = hasFlag("--screenshot");

  if (!service || !url) usageAndExit();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("url must start with http:// or https://");
  }

  const { chromium } = require("playwright");

  const runTs = nowIso();
  const date = today();
  const serviceSlug = safeSlug(service);
  const host = safeSlug(new URL(url).hostname);

  const outDir = path.join(os.homedir(), "notes", "sources", serviceSlug, date);
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = runTs.replace(/[:.]/g, "-");
  const base = `${stamp}_${host}`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  let payload;
  try {
    const context = await browser.newContext({
      javaScriptEnabled: true,
      bypassCSP: false,
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);

    const finalUrl = page.url();
    const title = await page.title();

    const copiedData = await page.evaluate((sel) => {
      const node = document.querySelector(sel) || document.body;
      const text = (node?.innerText || "").trim();
      const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 200).map((a) => {
        const href = a.getAttribute("href") || "";
        const label = (a.textContent || "").trim();
        return { href, label };
      });
      return {
        selector_used: sel,
        text_sample: text.slice(0, 12000),
        text_length: text.length,
        link_count: links.length,
        links,
      };
    }, selector);

    let screenshotPath = null;
    if (withScreenshot) {
      screenshotPath = path.join(outDir, `${base}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    payload = {
      service: serviceSlug,
      requested_url: url,
      final_url: finalUrl,
      timestamp: runTs,
      mode: "read_extract_only",
      guardrails: {
        form_submit: "blocked",
        purchase: "blocked",
        delete_action: "blocked",
        clicks_performed: 0,
      },
      copied_data: copiedData,
      title,
      screenshot: screenshotPath,
    };

    const jsonPath = path.join(outDir, `${base}.json`);
    const mdPath = path.join(outDir, `${base}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");

    const md = [
      "# Web Fallback Extraction",
      "",
      `- service: ${payload.service}`,
      `- timestamp: ${payload.timestamp}`,
      `- requested_url: ${payload.requested_url}`,
      `- final_url: ${payload.final_url}`,
      `- title: ${payload.title || ""}`,
      `- selector: ${payload.copied_data.selector_used}`,
      `- text_length: ${payload.copied_data.text_length}`,
      `- link_count: ${payload.copied_data.link_count}`,
      `- screenshot: ${payload.screenshot || "(not captured)"}`,
      "",
      "## Copied Data",
      "",
      "```text",
      payload.copied_data.text_sample || "",
      "```",
      "",
      "## Guardrails",
      "",
      "- Read/extract only.",
      "- No form submissions.",
      "- No purchases.",
      "- No delete operations.",
      "- Third-party upload not performed.",
    ].join("\n");

    fs.writeFileSync(mdPath, md + "\n");

    await context.close();

    console.log("✅ Web fallback extraction complete");
    console.log(`json: ${jsonPath}`);
    console.log(`markdown: ${mdPath}`);
    if (screenshotPath) console.log(`screenshot: ${screenshotPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[web-fallback-extract] fatal: ${err.message}`);
  process.exit(1);
});

"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function postJson(target, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(target);
    const mod = urlObj.protocol === "https:" ? https : http;
    const body = Buffer.from(JSON.stringify(payload));
    const req = mod.request(
      {
        method: "POST",
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: `${urlObj.pathname}${urlObj.search || ""}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { raw };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed?.error || `HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const apiBase = String(process.env.MEDIA_HUB_API_BASE_URL || "http://127.0.0.1:4051").replace(/\/+$/, "");
  const apiKey = process.env.ARCHITECT_API_KEY || "";
  const account = getArg("--account", process.env.MEDIA_HUB_PINTEREST_ACCOUNT || "");
  const board = getArg("--board", process.env.MEDIA_HUB_PINTEREST_BOARD || "");
  const destinationUrl = getArg("--url", process.env.MEDIA_HUB_DESTINATION_URL || "");
  const brand = getArg("--brand", process.env.MEDIA_HUB_BRAND || "");
  const reviewStatus = getArg("--review-status", process.env.MEDIA_HUB_REVIEW_STATUS || "approved");
  const limit = Math.max(1, Math.min(300, Number(getArg("--limit", process.env.MEDIA_HUB_AUTOPILOT_LIMIT || "80")) || 80));
  const dryRun = hasFlag("--apply") ? false : true;

  if (!account || !board) {
    throw new Error("Missing required account/board. Set --account/--board or MEDIA_HUB_PINTEREST_ACCOUNT/MEDIA_HUB_PINTEREST_BOARD.");
  }
  const endpoint = `${apiBase}/api/media-hub/queue/auto-from-filters`;
  const payload = {
    brand,
    review_status: reviewStatus,
    limit,
    pinterest_account: account,
    board_name: board,
    destination_url: destinationUrl || null,
    objective: "drive_traffic",
    tone: "confident",
    target_audience: "buyers",
    dry_run: dryRun,
    created_by: "media_hub_autopilot_script",
  };

  const response = await postJson(
    endpoint,
    payload,
    apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
        }
      : {}
  );
  const r = response.result || {};
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        dry_run: !!r.dry_run,
        inspected: Number(r.inspected || 0),
        created: Number(r.created || 0),
        skipped_existing: Number(r.skipped_existing || 0),
        errors: Number(r.errors || 0),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("media-hub-autopilot failed:", err.message);
  process.exit(1);
});

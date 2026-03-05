#!/usr/bin/env node
"use strict";

require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const HOST = getArg("--host", "127.0.0.1");
const PORT = Number(getArg("--port", process.env.WEBHOOK_PORT || "4040")) || 4040;
const BRAND = getArg("--brand", "skynpatch");
const LIMIT = Math.max(1, Number(getArg("--limit", "10")) || 10);
const SECRET = process.env.MAILEROO_WEBHOOK_SECRET || "";

function postJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const signature = SECRET
      ? `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`
      : "";
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(signature ? { "x-maileroo-signature": signature } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d.toString()));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function loadRecentSends(limit, brand) {
  const { rows } = await pg.query(
    `SELECT id, to_email, subject, maileroo_id
     FROM email_sends
     WHERE brand_slug = $1
       AND sent_at IS NOT NULL
     ORDER BY sent_at DESC
     LIMIT $2`,
    [brand, limit]
  );
  return rows;
}

function mkEvent(type, send, idx) {
  return {
    event: type,
    data: {
      message_id: send.maileroo_id || `replay-${send.id}-${idx}`,
      to: send.to_email,
      subject: send.subject,
      ...(type === "click" ? { url: "https://skynpatch.com/wholesale" } : {}),
      ...(type === "bounce" ? { reason: "mailbox_full", bounce_type: "soft" } : {}),
    },
  };
}

async function main() {
  const sends = await loadRecentSends(LIMIT, BRAND);
  if (!sends.length) {
    console.log("No sends available for replay.");
    return;
  }

  let ok = 0;
  let fail = 0;
  const events = ["delivered", "open", "click"];

  for (let i = 0; i < sends.length; i += 1) {
    const send = sends[i];
    for (const type of events) {
      const payload = mkEvent(type, send, i + 1);
      try {
        const res = await postJson("/api/webhook/maileroo", payload);
        if (res.status >= 200 && res.status < 300) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
  }

  console.log("\n=== Sales Webhook Replay ===\n");
  console.log(`brand: ${BRAND}`);
  console.log(`sends_replayed: ${sends.length}`);
  console.log(`events_ok: ${ok}`);
  console.log(`events_failed: ${fail}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

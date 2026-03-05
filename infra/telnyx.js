"use strict";

const https = require("https");

function sendTelnyxSms({ to, from, text, apiKey }) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("TELNYX_API_KEY not set");
  if (!to || !from || !text) throw new Error("sendTelnyxSms requires to, from, text");

  const payload = JSON.stringify({
    from,
    to,
    text,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telnyx.com",
        path: "/v2/messages",
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (d) => { raw += d; });
        res.on("end", () => {
          let body = raw;
          try { body = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body });
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { sendTelnyxSms };


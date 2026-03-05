"use strict";

const { google } = require("googleapis");

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${name}`);
  return String(v).trim();
}

function getAuth() {
  const clientId = requiredEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = requiredEnv("GOOGLE_OAUTH_REFRESH_TOKEN");
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "https://developers.google.com/oauthplayground";

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getGmail() {
  const auth = getAuth();
  return google.gmail({ version: "v1", auth });
}

function encodeBase64Url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildRawMessage({ from, to, subject, text, html, inReplyTo = null, references = null, actionId = null }) {
  const boundary = "claw-credit-boundary";
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  if (actionId) headers.push(`X-Claw-Credit-Action-Id: ${actionId}`);

  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text || "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html || `<pre>${(text || "").replace(/[<>&]/g, " ")}</pre>`,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

module.exports = {
  getGmail,
  buildRawMessage,
};


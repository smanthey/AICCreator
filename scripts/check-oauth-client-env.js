#!/usr/bin/env node
/**
 * Check that Google OAuth *client* env vars are set and valid.
 * Does NOT require GOOGLE_OAUTH_REFRESH_TOKEN (use after setting Client ID/Secret, before completing sign-in).
 *
 * Usage: node scripts/check-oauth-client-env.js
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
const redirectUri = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://127.0.0.1:4051/v1/credit/oauth/callback").trim();

console.log("\n=== OAuth client env check (no refresh token required) ===\n");

const issues = [];
if (!clientId) issues.push("GOOGLE_OAUTH_CLIENT_ID is missing or empty");
else if (!clientId.endsWith(".apps.googleusercontent.com")) issues.push("GOOGLE_OAUTH_CLIENT_ID should end with .apps.googleusercontent.com");
if (!clientSecret) issues.push("GOOGLE_OAUTH_CLIENT_SECRET is missing or empty");
else if (clientSecret.length < 20) issues.push("GOOGLE_OAUTH_CLIENT_SECRET looks too short");
if (!redirectUri.startsWith("http")) issues.push("GOOGLE_OAUTH_REDIRECT_URI should be a full URL (e.g. http://127.0.0.1:4051/v1/credit/oauth/callback)");

if (issues.length > 0) {
  console.log("❌ Issues:\n");
  issues.forEach((m) => console.log("  - " + m));
  console.log("\nSet these in .env and run again. Refresh token not needed for this check.\n");
  process.exit(1);
}

console.log("  GOOGLE_OAUTH_CLIENT_ID     : set (" + clientId.slice(0, 30) + "...)");
console.log("  GOOGLE_OAUTH_CLIENT_SECRET : set (" + clientSecret.length + " chars)");
console.log("  GOOGLE_OAUTH_REDIRECT_URI  : " + redirectUri);
console.log("\n✅ OAuth client env looks good. Next: complete sign-in to get refresh token, then set GOOGLE_OAUTH_REFRESH_TOKEN in .env.\n");
process.exit(0);

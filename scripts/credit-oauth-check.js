#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getGmail } = require("../infra/gmail-client");

async function main() {
  const gmail = getGmail();
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile?.data?.emailAddress || null;
  const messagesTotal = Number(profile?.data?.messagesTotal || 0);

  console.log("\n=== Credit OAuth Check ===\n");
  console.log(`ok: true`);
  console.log(`gmail_account: ${email || "unknown"}`);
  console.log(`messages_total: ${messagesTotal}`);
}

main().catch((err) => {
  console.error("\n=== Credit OAuth Check ===\n");
  console.error(`ok: false`);
  console.error(`error: ${err.message}`);
  process.exit(1);
});

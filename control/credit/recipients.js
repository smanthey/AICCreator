"use strict";

/**
 * Resolve dispute recipient email from action type and context.
 * Env vars (CREDIT_BUREAU_EMAIL, CREDIT_FURNISHER_EMAIL, etc.) override when set.
 * Otherwise uses built-in map so the pipeline never skips for missing config.
 */

const BUILTIN_BUREAU_EMAILS = {
  equifax: process.env.CREDIT_EQUIFAX_EMAIL || "dispute@equifax.com",
  experian: process.env.CREDIT_EXPERIAN_EMAIL || "dispute@experian.com",
  transunion: process.env.CREDIT_TRANSUNION_EMAIL || "dispute@transunion.com",
  other: process.env.CREDIT_BUREAU_EMAIL || "dispute@experian.com",
};

const FURNISHER_ALIASES = {
  edfinancial: "customercare@edfinancial.com",
  "ed financial": "customercare@edfinancial.com",
  "edfinancial services": "customercare@edfinancial.com",
  navient: "consumeradvocacy@navient.com",
  nelnet: "customer_service@nelnet.net",
  sallie mae: "customer.service@salliemae.com",
  discover: "discovercard_customerservice@discover.com",
  synchrony: "customer.service@synchronybank.com",
};

function normalizeFurnisher(name) {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function getBureauEmail(bureau) {
  const key = String(bureau || "").toLowerCase();
  if (process.env.CREDIT_BUREAU_EMAIL) return process.env.CREDIT_BUREAU_EMAIL;
  return BUILTIN_BUREAU_EMAILS[key] || BUILTIN_BUREAU_EMAILS.other;
}

function getFurnisherEmail(furnisherName) {
  if (process.env.CREDIT_FURNISHER_EMAIL) return process.env.CREDIT_FURNISHER_EMAIL;
  const n = normalizeFurnisher(furnisherName);
  if (!n) return process.env.CREDIT_FURNISHER_EMAIL || "";
  for (const [alias, email] of Object.entries(FURNISHER_ALIASES)) {
    if (n.includes(alias) || alias.includes(n)) return email;
  }
  return "";
}

function getCollectorEmail() {
  return process.env.CREDIT_COLLECTOR_EMAIL || process.env.CREDIT_FURNISHER_EMAIL || "";
}

function getCFPBEmail() {
  return process.env.CREDIT_CFPB_EMAIL || "";
}

/**
 * @param {string} actionType - bureau_dispute | furnisher_dispute | debt_validation | cfpb_escalation
 * @param {{ bureau?: string, furnisher_name?: string }} ctx - from issue/report/item
 * @returns {string} email or empty if not resolvable
 */
function getRecipient(actionType, ctx = {}) {
  const t = String(actionType || "").trim();
  if (t === "bureau_dispute") return getBureauEmail(ctx.bureau);
  if (t === "furnisher_dispute") {
    const furnisherEmail = getFurnisherEmail(ctx.furnisher_name);
    if (furnisherEmail) return furnisherEmail;
    return process.env.CREDIT_FURNISHER_EMAIL || "";
  }
  if (t === "debt_validation") return getCollectorEmail();
  if (t === "cfpb_escalation") return getCFPBEmail();
  return "";
}

module.exports = {
  getRecipient,
  getBureauEmail,
  getFurnisherEmail,
  FURNISHER_ALIASES,
  BUILTIN_BUREAU_EMAILS,
};

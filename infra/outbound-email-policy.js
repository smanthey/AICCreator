"use strict";

const pg = require("./postgres");

function splitCsv(v) {
  return String(v || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

async function resolveBrandSender(brandSlug, fallbackName = "Scott", fallbackEmail = "") {
  const { rows } = await pg.query(
    `SELECT slug, from_name, brand_email, provisioning_status
     FROM brands
     WHERE slug = $1
     LIMIT 1`,
    [brandSlug]
  );
  const b = rows[0] || {};
  return {
    fromName: b.from_name || fallbackName,
    fromEmail: b.brand_email || fallbackEmail,
    provisioningStatus: b.provisioning_status || null,
  };
}

function enforceSender({ brandSlug, fromEmail, provisioningStatus = null }) {
  const enforceSkyn = String(process.env.ENFORCE_SKYNPATCH_FROM_EMAIL || "true").toLowerCase() !== "false";
  const expectedSkyn = String(process.env.SKYNPATCH_PROD_FROM_EMAIL || "shop@skynpatch.com").toLowerCase();
  const allowed = splitCsv(process.env.MAILEROO_ALLOWED_FROM_EMAILS || expectedSkyn);
  const email = String(fromEmail || "").trim().toLowerCase();

  if (!email) throw new Error("sender_email_missing");
  if (allowed.length && !allowed.includes(email)) {
    throw new Error(`sender_email_not_allowed:${email}`);
  }
  if (enforceSkyn && String(brandSlug || "").toLowerCase() === "skynpatch" && email !== expectedSkyn) {
    throw new Error(`skynpatch_sender_must_be:${expectedSkyn}`);
  }
  if (String(brandSlug || "").toLowerCase() === "skynpatch") {
    const okStates = new Set(["active", "ready", "verified", "provisioning"]);
    if (provisioningStatus && !okStates.has(String(provisioningStatus).toLowerCase())) {
      throw new Error(`brand_not_ready_for_send:${provisioningStatus}`);
    }
  }
}

module.exports = {
  resolveBrandSender,
  enforceSender,
};


"use strict";

const { register } = require("./registry");
const pg = require("../infra/postgres");
const { decryptSecret } = require("../infra/secrets-crypto");

const MAILEROO_BASE_URL = process.env.MAILEROO_BASE_URL || "https://api.maileroo.com/v1";
const MAILEROO_DOMAINS_PATH = process.env.MAILEROO_DOMAINS_PATH || "/domains";
const MAILEROO_SENDERS_PATH = process.env.MAILEROO_SENDERS_PATH || "/senders";
const MAILEROO_WEBHOOKS_PATH = process.env.MAILEROO_WEBHOOKS_PATH || "/webhooks";
const CLOUDFLARE_BASE_URL = "https://api.cloudflare.com/client/v4";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mailerooHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function normalizeDnsRecords(domainResp = {}) {
  const records = [];
  const candidates = [];
  if (Array.isArray(domainResp.records)) candidates.push(...domainResp.records);
  if (Array.isArray(domainResp.dns_records)) candidates.push(...domainResp.dns_records);
  if (domainResp.data && Array.isArray(domainResp.data.records)) candidates.push(...domainResp.data.records);
  if (domainResp.data && Array.isArray(domainResp.data.dns_records)) candidates.push(...domainResp.data.dns_records);

  for (const r of candidates) {
    const type = (r.type || r.record_type || "").toUpperCase();
    const name = r.name || r.host || r.record_name;
    const content = r.content || r.value || r.target;
    if (!type || !name || content == null) continue;
    records.push({
      type,
      name,
      content: String(content),
      ttl: Number(r.ttl || 3600),
      priority: r.priority != null ? Number(r.priority) : null,
      proxied: false,
    });
  }
  return records;
}

function isMailerooVerified(domainResp = {}) {
  const src = domainResp.data || domainResp;
  if (src.verified === true) return true;
  if (typeof src.status === "string" && ["verified", "active", "ready"].includes(src.status.toLowerCase())) return true;
  return false;
}

async function logStep(brandId, stepName, status, detail, payload = {}) {
  await pg.query(
    `INSERT INTO brand_provision_runs (brand_id, step_name, status, detail, payload_json, completed_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    [brandId, stepName, status, detail || null, payload || {}]
  );
}

async function getBrandContext(brandId) {
  const { rows } = await pg.query(
    `SELECT b.*, bs.maileroo_api_key_encrypted, bs.cloudflare_api_token_encrypted
       FROM brands b
  LEFT JOIN brand_secrets bs ON bs.brand_id = b.id
      WHERE b.id = $1
      LIMIT 1`,
    [brandId]
  );
  return rows[0] || null;
}

async function createMailerooDomain(brand, apiKey) {
  const body = { domain: brand.sending_domain };
  const res = await fetch(`${MAILEROO_BASE_URL}${MAILEROO_DOMAINS_PATH}`, {
    method: "POST",
    headers: mailerooHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`maileroo domain create failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

async function fetchMailerooDomain(brand, apiKey) {
  const domain = encodeURIComponent(brand.sending_domain);
  const res = await fetch(`${MAILEROO_BASE_URL}${MAILEROO_DOMAINS_PATH}/${domain}`, {
    method: "GET",
    headers: mailerooHeaders(apiKey),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`maileroo domain verify failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

async function createMailerooSender(brand, apiKey) {
  const res = await fetch(`${MAILEROO_BASE_URL}${MAILEROO_SENDERS_PATH}`, {
    method: "POST",
    headers: mailerooHeaders(apiKey),
    body: JSON.stringify({
      name: brand.default_from_name || brand.name || brand.slug,
      email: brand.default_from_email,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`maileroo sender create failed (${res.status}): ${t.slice(0, 500)}`);
  }
  return res.json().catch(() => ({}));
}

async function createMailerooWebhook(brand, apiKey) {
  const endpoint =
    process.env.BRAND_WEBHOOK_BASE_URL
      ? `${process.env.BRAND_WEBHOOK_BASE_URL.replace(/\/+$/, "")}/api/webhook/maileroo`
      : null;
  if (!endpoint) return { skipped: true, reason: "BRAND_WEBHOOK_BASE_URL not set" };
  const res = await fetch(`${MAILEROO_BASE_URL}${MAILEROO_WEBHOOKS_PATH}`, {
    method: "POST",
    headers: mailerooHeaders(apiKey),
    body: JSON.stringify({
      url: endpoint,
      events: ["delivered", "bounce", "complaint", "open", "click", "unsubscribe"],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`maileroo webhook create failed (${res.status}): ${t.slice(0, 500)}`);
  }
  return res.json().catch(() => ({}));
}

async function applyCloudflareDns(zoneId, token, records) {
  const applied = [];
  for (const r of records) {
    const body = {
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl || 3600,
      proxied: false,
    };
    if (r.priority != null) body.priority = r.priority;

    const res = await fetch(`${CLOUDFLARE_BASE_URL}/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}
    if (!res.ok || json.success === false) {
      throw new Error(`cloudflare dns apply failed (${res.status}): ${text.slice(0, 500)}`);
    }
    applied.push({ ...r, cloudflare_id: json.result?.id || null });
  }
  return applied;
}

register("brand_provision", async (payload) => {
  const brandId = payload.brand_id;
  if (!brandId) throw new Error("brand_provision requires payload.brand_id");

  let brand = await getBrandContext(brandId);
  if (!brand) throw new Error(`brand not found: ${brandId}`);

  await pg.query(
    `UPDATE brands
        SET provisioning_status = 'provisioning',
            provisioning_error = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [brandId]
  );
  await logStep(brandId, "start", "completed", "provisioning started", { brand_id: brandId });

  const mailerooApiKey =
    decryptSecret(brand.maileroo_api_key_encrypted) ||
    process.env.MAILEROO_MASTER_API_KEY ||
    process.env.MAILEROO_API_KEY;
  if (!mailerooApiKey) {
    await pg.query(
      `UPDATE brands
          SET provisioning_status='action_required',
              provisioning_error='Missing Maileroo API key',
              updated_at=NOW()
        WHERE id=$1`,
      [brandId]
    );
    await logStep(brandId, "maileroo_domain_create", "failed", "missing Maileroo API key");
    return { brand_id: brandId, status: "action_required", reason: "missing_maileroo_key" };
  }

  let createdDomain = null;
  let dnsRecords = [];
  try {
    createdDomain = await createMailerooDomain(brand, mailerooApiKey);
    dnsRecords = normalizeDnsRecords(createdDomain);
    await logStep(brandId, "maileroo_domain_create", "completed", "maileroo domain created", {
      records: dnsRecords.length,
    });
  } catch (err) {
    await logStep(brandId, "maileroo_domain_create", "failed", err.message);
    await pg.query(
      `UPDATE brands
          SET provisioning_status='failed',
              provisioning_error=$2,
              updated_at=NOW()
        WHERE id=$1`,
      [brandId, err.message]
    );
    return { brand_id: brandId, status: "failed", reason: "maileroo_domain_create_failed", error: err.message };
  }

  const cfToken =
    decryptSecret(brand.cloudflare_api_token_encrypted) ||
    process.env.CLOUDFLARE_API_TOKEN ||
    "";
  if (brand.dns_provider === "cloudflare" && brand.dns_zone_id && cfToken && dnsRecords.length > 0) {
    try {
      const applied = await applyCloudflareDns(brand.dns_zone_id, cfToken, dnsRecords);
      await logStep(brandId, "dns_apply", "completed", "cloudflare dns records applied", {
        records: applied.length,
      });
    } catch (err) {
      await logStep(brandId, "dns_apply", "failed", err.message);
      await pg.query(
        `UPDATE brands
            SET provisioning_status='action_required',
                provisioning_error=$2,
                updated_at=NOW()
          WHERE id=$1`,
        [brandId, `DNS apply failed: ${err.message}`]
      );
      return { brand_id: brandId, status: "action_required", reason: "dns_apply_failed", error: err.message };
    }
  } else {
    await logStep(
      brandId,
      "dns_apply",
      "skipped",
      "cloudflare credentials/records unavailable; returning DNS plan",
      { records: dnsRecords }
    );
  }

  // verify loop (up to ~60s)
  let verified = false;
  let latestDomain = createdDomain || {};
  for (let i = 0; i < 12; i++) {
    try {
      latestDomain = await fetchMailerooDomain(brand, mailerooApiKey);
      verified = isMailerooVerified(latestDomain);
      if (verified) break;
    } catch (err) {
      await logStep(brandId, "maileroo_verify_poll", "failed", err.message, { attempt: i + 1 });
    }
    await sleep(5000);
  }
  if (!verified) {
    await logStep(brandId, "maileroo_verify", "failed", "domain not verified in polling window");
    await pg.query(
      `UPDATE brands
          SET provisioning_status='action_required',
              provisioning_error='Maileroo domain not verified yet',
              provisioning_meta = COALESCE(provisioning_meta,'{}'::jsonb) || jsonb_build_object('dns_records', $2::jsonb),
              updated_at=NOW()
        WHERE id=$1`,
      [brandId, JSON.stringify(dnsRecords)]
    );
    return { brand_id: brandId, status: "action_required", reason: "maileroo_not_verified", dns_records: dnsRecords };
  }
  await logStep(brandId, "maileroo_verify", "completed", "maileroo domain verified");

  // sender + webhook registration
  try {
    const sender = await createMailerooSender(brand, mailerooApiKey);
    await logStep(brandId, "maileroo_sender", "completed", "sender identity created", sender);
  } catch (err) {
    await logStep(brandId, "maileroo_sender", "failed", err.message);
  }

  try {
    const webhook = await createMailerooWebhook(brand, mailerooApiKey);
    await logStep(brandId, "maileroo_webhook", "completed", "maileroo webhook registered", webhook);
  } catch (err) {
    await logStep(brandId, "maileroo_webhook", "failed", err.message);
  }

  await pg.query(
    `UPDATE brands
        SET provisioning_status='ready',
            provisioning_error=NULL,
            last_provisioned_at=NOW(),
            provisioning_meta = COALESCE(provisioning_meta,'{}'::jsonb) ||
              jsonb_build_object('dns_records', $2::jsonb, 'maileroo_domain', $3::jsonb),
            updated_at=NOW()
      WHERE id=$1`,
    [brandId, JSON.stringify(dnsRecords), JSON.stringify(latestDomain || {})]
  );
  await logStep(brandId, "complete", "completed", "brand provisioning complete");

  brand = await getBrandContext(brandId);
  return {
    brand_id: brandId,
    status: brand.provisioning_status,
    sending_domain: brand.sending_domain,
    cost_usd: 0,
    model_used: "deterministic-brand-provisioner",
  };
});

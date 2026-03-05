"use strict";

function toCents(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100);
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function toPoints(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return Math.round(fallback);
  return Math.round(n);
}

function pick(obj, keys = []) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
}

function parseOccurredAt(payload) {
  const p = payload || {};
  const candidate =
    p.occurred_at ||
    p.event_time ||
    p.timestamp ||
    p.created_at ||
    p.updated_at ||
    p.order?.completed_at ||
    p.order?.created_at ||
    p.data?.occurred_at ||
    p.data?.timestamp ||
    null;
  if (!candidate) return null;
  const d = new Date(candidate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeLineItems(payload) {
  const p = payload || {};
  const order = p.order || p.transaction || p.data?.order || p.data?.transaction || p.data || {};
  const lineItems = order.line_items || order.items || p.line_items || p.items || p.data?.line_items || p.data?.items || [];
  if (!Array.isArray(lineItems)) return [];

  return lineItems.map((li, idx) => ({
    line_no: idx + 1,
    sku: pick(li, ["sku", "sku_id", "upc", "barcode"]) || null,
    product_id: String(pick(li, ["product_id", "id", "item_id"]) || "") || null,
    product_name: pick(li, ["name", "product_name", "title"]) || null,
    category: pick(li, ["category", "product_category"]) || null,
    brand: pick(li, ["brand", "product_brand"]) || null,
    quantity: Number(pick(li, ["quantity", "qty"]) || 1),
    unit_price_cents: toCents(pick(li, ["unit_price", "price", "unit_amount"])) ,
    discount_cents: toCents(pick(li, ["discount", "discount_amount"])),
    tax_cents: toCents(pick(li, ["tax", "tax_amount"])),
    line_total_cents: toCents(pick(li, ["line_total", "total", "amount"])),
    payload_json: li || {},
  }));
}

function normalizeWebhookEnvelope(webhookRow) {
  const provider = String(webhookRow.provider || "unknown").toLowerCase();
  const eventType = String(webhookRow.event_type || "unknown");
  const payload = webhookRow.payload_json || {};
  const order = payload.order || payload.transaction || payload.data?.order || payload.data?.transaction || payload.data || {};
  const customer = payload.customer || payload.member || payload.user || payload.profile || payload.data?.customer || payload.data?.member || {};

  const normalizedEventId = String(
    webhookRow.event_id || payload.event_id || payload.id || order.id || payload.data?.id || webhookRow.id || ""
  );

  return {
    provider,
    source_system: webhookRow.source_system || payload.source_system || provider,
    event_type: eventType,
    event_id: normalizedEventId,
    event_version: webhookRow.event_version || payload.event_version || payload.version || null,
    schema_version: webhookRow.schema_version || payload.schema_version || payload.schemaVersion || null,
    occurred_at: parseOccurredAt(payload),
    order_id: String(pick(order, ["id", "order_id", "external_id"]) || normalizedEventId || "") || null,
    order_status: pick(order, ["status", "order_status"]) || null,
    store_id: String(
      pick(payload, ["store_id", "location_id"]) ||
      pick(order, ["store_id", "location_id"]) ||
      pick(payload.data || {}, ["store_id", "location_id"]) ||
      ""
    ) || null,
    customer_external_id: String(
      pick(customer, ["id", "external_id", "customer_id", "member_id"]) ||
      pick(payload, ["customer_id", "member_id"]) ||
      ""
    ) || null,
    customer_loyalty_id: String(
      pick(customer, ["loyalty_id", "loyalty_member_id"]) ||
      pick(payload, ["loyalty_id", "loyalty_member_id"]) ||
      ""
    ) || null,
    customer_email: String(pick(customer, ["email"]) || pick(payload, ["email"]) || "").toLowerCase() || null,
    customer_phone: String(pick(customer, ["phone", "phone_number"]) || pick(payload, ["phone", "phone_number"]) || "") || null,
    subtotal_cents: toCents(pick(order, ["subtotal", "sub_total", "subtotal_amount"])),
    discount_cents: toCents(pick(order, ["discount", "discount_total", "total_discount"])),
    tax_cents: toCents(pick(order, ["tax", "tax_total", "total_tax"])),
    total_cents: toCents(pick(order, ["total", "amount", "grand_total", "amount_total"])),
    currency_code: String(
      pick(order, ["currency", "currency_code"]) ||
      pick(payload, ["currency", "currency_code"]) ||
      "USD"
    ).toUpperCase(),
    payload_json: payload,
    line_items: normalizeLineItems(payload),
  };
}

function detectWalletPassBrand(provider, eventTypeRaw, payload) {
  const p = payload || {};
  const probe = [
    p.wallet_pass_id,
    p.pass_id,
    p.pass_name,
    p.pass_title,
    p.wallet_name,
    p.data?.wallet_pass_id,
    p.data?.pass_id,
    p.data?.pass_name,
    p.customer?.wallet_pass_id,
    p.customer?.pass_id,
    p.customer?.pass_name,
    eventTypeRaw,
    provider,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!probe) return null;
  if (/cookiespass.*copy|cookies.*tempe|tempe.*cookies/.test(probe)) return "cookies";
  if (/cookiespass|nirvana/.test(probe)) return "nirvana";
  return null;
}

function detectLoyaltyEvent(provider, eventTypeRaw, payload) {
  const eventType = String(eventTypeRaw || "").toLowerCase();
  const p = payload || {};
  const walletPassBrand = detectWalletPassBrand(provider, eventTypeRaw, payload);

  const customer = p.customer || p.member || p.user || p.profile || p.data?.customer || p.data?.member || {};
  const order = p.order || p.transaction || p.data?.order || p.data?.transaction || p.data || {};

  const amountCents = toCents(
    pick(order, ["total", "subtotal", "amount", "amount_total"]) ??
    pick(p, ["amount", "order_total", "total"])
  );

  const explicitEarn = pick(order, ["points_earned", "earned_points"]) ?? pick(p, ["points_earned", "earned_points"]);
  const explicitRedeem = pick(order, ["points_redeemed", "redeemed_points"]) ?? pick(p, ["points_redeemed", "redeemed_points"]);

  let txType = "earn";
  if (/(redeem|redemption|reward_redeemed|points_used|return|refund)/.test(eventType)) txType = "redeem";
  if (/(adjust|manual_adjustment|admin_adjustment)/.test(eventType)) txType = "adjust";
  if (/(expire|expiration)/.test(eventType)) txType = "expire";

  let pointsDelta = 0;
  if (txType === "redeem") {
    pointsDelta = -Math.abs(toPoints(explicitRedeem, 0));
  } else if (txType === "expire") {
    pointsDelta = -Math.abs(toPoints(p.points_expired ?? p.expired_points ?? 0, 0));
  } else if (txType === "adjust") {
    pointsDelta = toPoints(p.points_delta ?? p.adjustment_points ?? 0, 0);
  } else {
    const fallbackEarn = amountCents !== null ? Math.floor(amountCents / 100) : 0;
    pointsDelta = Math.max(0, toPoints(explicitEarn, fallbackEarn));
  }

  const member = {
    provider,
    external_ref: String(
      pick(customer, ["id", "external_id", "member_id", "customer_id"]) ||
      pick(p, ["member_id", "customer_id", "user_id"]) ||
      ""
    ) || null,
    email: String(pick(customer, ["email"]) || pick(p, ["email"]) || "").toLowerCase() || null,
    phone: String(pick(customer, ["phone", "phone_number"]) || pick(p, ["phone", "phone_number"]) || "") || null,
    first_name: pick(customer, ["first_name", "firstname", "given_name"]) || null,
    last_name: pick(customer, ["last_name", "lastname", "family_name"]) || null,
    wallet_pass_id: String(
      pick(customer, ["wallet_pass_id", "pass_id"]) ||
      pick(p, ["wallet_pass_id", "pass_id"]) ||
      ""
    ) || null,
    metadata_json: {
      source_provider: provider,
      source_event_type: eventTypeRaw || null,
      wallet_pass_brand: walletPassBrand,
    },
  };

  return {
    txType,
    pointsDelta,
    amountCents,
    member,
  };
}

function tierForLifetime(lifetime) {
  const p = Number(lifetime || 0);
  if (p >= 10000) return "platinum";
  if (p >= 5000) return "gold";
  if (p >= 1000) return "silver";
  return "base";
}

async function upsertMemberAndAccount(db, member) {
  let row = null;
  if (member.external_ref) {
    const r = await db.query(
      `INSERT INTO loyalty_members
         (provider, external_ref, email, phone, first_name, last_name, wallet_pass_id, metadata_json)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (provider, external_ref)
       DO UPDATE SET
         email = COALESCE(EXCLUDED.email, loyalty_members.email),
         phone = COALESCE(EXCLUDED.phone, loyalty_members.phone),
         first_name = COALESCE(EXCLUDED.first_name, loyalty_members.first_name),
         last_name = COALESCE(EXCLUDED.last_name, loyalty_members.last_name),
         wallet_pass_id = COALESCE(EXCLUDED.wallet_pass_id, loyalty_members.wallet_pass_id),
         metadata_json = loyalty_members.metadata_json || EXCLUDED.metadata_json,
         updated_at = NOW()
       RETURNING id, email, phone, wallet_pass_id, metadata_json`,
      [
        member.provider,
        member.external_ref,
        member.email,
        member.phone,
        member.first_name,
        member.last_name,
        member.wallet_pass_id,
        JSON.stringify(member.metadata_json || {}),
      ]
    );
    row = r.rows[0];
  } else {
    const r = await db.query(
      `INSERT INTO loyalty_members
         (provider, email, phone, first_name, last_name, wallet_pass_id, metadata_json)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id, email, phone, wallet_pass_id, metadata_json`,
      [
        member.provider,
        member.email,
        member.phone,
        member.first_name,
        member.last_name,
        member.wallet_pass_id,
        JSON.stringify(member.metadata_json || {}),
      ]
    );
    row = r.rows[0];
  }

  await db.query(
    `INSERT INTO loyalty_accounts (member_id)
     VALUES ($1)
     ON CONFLICT (member_id) DO NOTHING`,
    [row.id]
  );
  return row;
}

async function queueOutreach(db, { memberId, channel, templateKey, payload, dedupeKey }) {
  if (!memberId || !channel || !templateKey) return;
  await db.query(
    `INSERT INTO loyalty_outreach_queue
       (member_id, channel, template_key, dedupe_key, payload_json, status)
     VALUES
       ($1,$2,$3,$4,$5::jsonb,'queued')
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [memberId, channel, templateKey, dedupeKey || null, JSON.stringify(payload || {})]
  );
}

async function upsertOrderEvent(db, webhookRow) {
  const n = normalizeWebhookEnvelope(webhookRow);
  const { rows } = await db.query(
    `INSERT INTO loyalty_order_events
       (webhook_event_id, provider, source_system, event_id, event_type, event_version, schema_version,
        order_id, order_status, store_id, customer_external_id, customer_loyalty_id, customer_email, customer_phone,
        subtotal_cents, discount_cents, tax_cents, total_cents, currency_code, payload_json, occurred_at)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::timestamptz)
     ON CONFLICT (provider, event_id, event_type)
     DO UPDATE SET
       source_system = COALESCE(EXCLUDED.source_system, loyalty_order_events.source_system),
       event_version = COALESCE(EXCLUDED.event_version, loyalty_order_events.event_version),
       schema_version = COALESCE(EXCLUDED.schema_version, loyalty_order_events.schema_version),
       order_status = COALESCE(EXCLUDED.order_status, loyalty_order_events.order_status),
       store_id = COALESCE(EXCLUDED.store_id, loyalty_order_events.store_id),
       customer_external_id = COALESCE(EXCLUDED.customer_external_id, loyalty_order_events.customer_external_id),
       customer_loyalty_id = COALESCE(EXCLUDED.customer_loyalty_id, loyalty_order_events.customer_loyalty_id),
       customer_email = COALESCE(EXCLUDED.customer_email, loyalty_order_events.customer_email),
       customer_phone = COALESCE(EXCLUDED.customer_phone, loyalty_order_events.customer_phone),
       subtotal_cents = COALESCE(EXCLUDED.subtotal_cents, loyalty_order_events.subtotal_cents),
       discount_cents = COALESCE(EXCLUDED.discount_cents, loyalty_order_events.discount_cents),
       tax_cents = COALESCE(EXCLUDED.tax_cents, loyalty_order_events.tax_cents),
       total_cents = COALESCE(EXCLUDED.total_cents, loyalty_order_events.total_cents),
       currency_code = COALESCE(EXCLUDED.currency_code, loyalty_order_events.currency_code),
       payload_json = EXCLUDED.payload_json,
       occurred_at = COALESCE(EXCLUDED.occurred_at, loyalty_order_events.occurred_at),
       updated_at = NOW()
     RETURNING id`,
    [
      webhookRow.id,
      n.provider,
      n.source_system,
      n.event_id || null,
      n.event_type,
      n.event_version,
      n.schema_version,
      n.order_id,
      n.order_status,
      n.store_id,
      n.customer_external_id,
      n.customer_loyalty_id,
      n.customer_email,
      n.customer_phone,
      n.subtotal_cents,
      n.discount_cents,
      n.tax_cents,
      n.total_cents,
      n.currency_code,
      JSON.stringify(n.payload_json || {}),
      n.occurred_at,
    ]
  );
  const orderEventId = rows[0]?.id || null;
  if (!orderEventId) return null;

  await db.query(`DELETE FROM loyalty_order_line_items WHERE order_event_id = $1`, [orderEventId]);
  for (const item of n.line_items) {
    await db.query(
      `INSERT INTO loyalty_order_line_items
         (order_event_id, line_no, sku, product_id, product_name, category, brand, quantity,
          unit_price_cents, discount_cents, tax_cents, line_total_cents, payload_json)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        orderEventId,
        item.line_no,
        item.sku,
        item.product_id,
        item.product_name,
        item.category,
        item.brand,
        item.quantity,
        item.unit_price_cents,
        item.discount_cents,
        item.tax_cents,
        item.line_total_cents,
        JSON.stringify(item.payload_json || {}),
      ]
    );
  }
  return { id: orderEventId, normalized: n };
}

function loyaltyPublishEventsToRedis() {
  const v = process.env.LOYALTY_PUBLISH_EVENTS_TO_REDIS;
  return v != null && ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

async function emitDomainEvent(db, row) {
  await db.query(
    `INSERT INTO loyalty_domain_events
       (provider, source_system, source_webhook_event_id, source_order_event_id, source_event_id,
        source_event_type, domain_event_type, domain_event_key, payload_json, occurred_at)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
     ON CONFLICT (domain_event_key) DO NOTHING`,
    [
      row.provider || "unknown",
      row.source_system || row.provider || "unknown",
      row.source_webhook_event_id || null,
      row.source_order_event_id || null,
      row.source_event_id || null,
      row.source_event_type || null,
      row.domain_event_type,
      row.domain_event_key,
      JSON.stringify(row.payload_json || {}),
      row.occurred_at || new Date().toISOString(),
    ]
  );

  if (loyaltyPublishEventsToRedis()) {
    const eventBus = require("../event-bus");
    eventBus.publishDomainEvent("events.domain", {
      event_type: row.domain_event_type,
      domain: "loyalty",
      payload: row.payload_json || {},
      occurred_at: row.occurred_at || new Date().toISOString(),
      domain_event_key: row.domain_event_key,
      idempotency_key: row.domain_event_key,
      version: 1,
      source_system: row.source_system || row.provider,
      source_event_id: row.source_event_id,
    }).catch((err) => {
      console.warn("[loyalty] event-bus publish failed:", err.message);
    });
  }
}

async function applyWebhookEvent(db, webhookRow) {
  const provider = String(webhookRow.provider || "unknown").toLowerCase();
  const eventType = webhookRow.event_type || "";
  const eventId = webhookRow.event_id || webhookRow.id;
  const payload = webhookRow.payload_json || {};
  const orderEvent = await upsertOrderEvent(db, webhookRow);
  const normalized = orderEvent?.normalized || normalizeWebhookEnvelope(webhookRow);

  const detected = detectLoyaltyEvent(provider, eventType, payload);
  const member = await upsertMemberAndAccount(db, detected.member);

  const et = String(eventType || "").toLowerCase();
  const lifecycleMap = {
    "order.created": "customer.transaction.created",
    "order.updated": "customer.transaction.updated",
    "order.cancelled": "customer.transaction.cancelled",
    "order.refunded": "customer.transaction.refunded",
    "order.completed": "customer.transaction.recorded",
  };
  if (lifecycleMap[et]) {
    await emitDomainEvent(db, {
      provider,
      source_system: normalized.source_system,
      source_webhook_event_id: webhookRow.id,
      source_order_event_id: orderEvent?.id || null,
      source_event_id: String(eventId || ""),
      source_event_type: eventType,
      domain_event_type: lifecycleMap[et],
      domain_event_key: `${provider}:${String(eventId || "")}:${lifecycleMap[et]}`,
      payload_json: {
        event_type: eventType,
        order_id: normalized.order_id,
        order_status: normalized.order_status,
        store_id: normalized.store_id,
        customer_external_id: normalized.customer_external_id,
      },
      occurred_at: normalized.occurred_at,
    });
  }

  if (/^wallet\.pass\./.test(et)) {
    await emitDomainEvent(db, {
      provider,
      source_system: normalized.source_system,
      source_webhook_event_id: webhookRow.id,
      source_order_event_id: orderEvent?.id || null,
      source_event_id: String(eventId || ""),
      source_event_type: eventType,
      domain_event_type: et,
      domain_event_key: `${provider}:${String(eventId || "")}:${et}`,
      payload_json: {
        wallet_pass_id: detected.member.wallet_pass_id,
        wallet_pass_brand: detected.member.metadata_json?.wallet_pass_brand || null,
      },
      occurred_at: normalized.occurred_at,
    });
  }

  if (detected.pointsDelta !== 0) {
    await db.query(
      `INSERT INTO loyalty_transactions
         (member_id, source_provider, source_event_id, source_event_type, tx_type, points_delta, amount_cents, payload_json)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (source_provider, source_event_id, tx_type)
       DO NOTHING`,
      [
        member.id,
        provider,
        String(eventId || ""),
        eventType,
        detected.txType,
        detected.pointsDelta,
        detected.amountCents,
        JSON.stringify(payload || {}),
      ]
    );

    const { rows } = await db.query(
      `UPDATE loyalty_accounts
       SET points_balance = GREATEST(0, points_balance + $2),
           lifetime_points = GREATEST(0, lifetime_points + CASE WHEN $2 > 0 THEN $2 ELSE 0 END),
           updated_at = NOW()
       WHERE member_id = $1
       RETURNING points_balance, lifetime_points`,
      [member.id, detected.pointsDelta]
    );

    const acct = rows[0] || { points_balance: 0, lifetime_points: 0 };
    const tier = tierForLifetime(acct.lifetime_points);
    await db.query(
      `UPDATE loyalty_accounts SET tier = $2, updated_at = NOW() WHERE member_id = $1`,
      [member.id, tier]
    );

    const basePayload = {
      provider,
      event_type: eventType,
      source_event_id: String(eventId || ""),
      points_delta: detected.pointsDelta,
      points_balance: acct.points_balance,
      lifetime_points: acct.lifetime_points,
      tier,
      amount_cents: detected.amountCents,
      email: member.email,
      phone: member.phone,
      wallet_pass_id: member.wallet_pass_id,
      wallet_pass_brand: member.metadata_json?.wallet_pass_brand || null,
    };

    if (member.email) {
      await queueOutreach(db, {
        memberId: member.id,
        channel: "email",
        templateKey: "loyalty_points_update",
        payload: basePayload,
        dedupeKey: `${provider}:${eventId}:email:loyalty_points_update`,
      });
    }
    if (member.phone) {
      await queueOutreach(db, {
        memberId: member.id,
        channel: "sms",
        templateKey: "loyalty_points_update",
        payload: basePayload,
        dedupeKey: `${provider}:${eventId}:sms:loyalty_points_update`,
      });
    }
    if (member.wallet_pass_id) {
      await queueOutreach(db, {
        memberId: member.id,
        channel: "wallet_pass",
        templateKey: "loyalty_points_update",
        payload: basePayload,
        dedupeKey: `${provider}:${eventId}:wallet_pass:loyalty_points_update`,
      });
    }

    const pointsEventType =
      detected.txType === "earn" ? "loyalty.points.earned" :
      detected.txType === "redeem" ? "loyalty.points.redeemed" :
      detected.txType === "adjust" ? "loyalty.points.adjusted" :
      "loyalty.points.expired";

    await emitDomainEvent(db, {
      provider,
      source_system: normalized.source_system,
      source_webhook_event_id: webhookRow.id,
      source_order_event_id: orderEvent?.id || null,
      source_event_id: String(eventId || ""),
      source_event_type: eventType,
      domain_event_type: pointsEventType,
      domain_event_key: `${provider}:${String(eventId || "")}:${pointsEventType}`,
      payload_json: basePayload,
      occurred_at: normalized.occurred_at,
    });

    await emitDomainEvent(db, {
      provider,
      source_system: normalized.source_system,
      source_webhook_event_id: webhookRow.id,
      source_order_event_id: orderEvent?.id || null,
      source_event_id: String(eventId || ""),
      source_event_type: eventType,
      domain_event_type: "wallet.balance.updated",
      domain_event_key: `${provider}:${String(eventId || "")}:wallet.balance.updated`,
      payload_json: basePayload,
      occurred_at: normalized.occurred_at,
    });
  }
}

async function enqueueWebhook(db, { provider, eventType, eventId, signatureValid, payload, sourceSystem, eventVersion, schemaVersion, headers }) {
  const { rows } = await db.query(
    `INSERT INTO loyalty_webhook_events
       (provider, source_system, event_type, event_id, event_version, schema_version, signature_valid, headers_json, payload_json, processing_status)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'queued')
     ON CONFLICT (provider, event_id)
     DO UPDATE SET
       source_system = COALESCE(EXCLUDED.source_system, loyalty_webhook_events.source_system),
       event_type = COALESCE(EXCLUDED.event_type, loyalty_webhook_events.event_type),
       event_version = COALESCE(EXCLUDED.event_version, loyalty_webhook_events.event_version),
       schema_version = COALESCE(EXCLUDED.schema_version, loyalty_webhook_events.schema_version),
       signature_valid = EXCLUDED.signature_valid,
       headers_json = EXCLUDED.headers_json,
       payload_json = EXCLUDED.payload_json,
       retry_count = loyalty_webhook_events.retry_count + 1,
       processing_status = CASE
         WHEN loyalty_webhook_events.processing_status = 'processed' THEN 'processed'
         ELSE 'queued'
       END,
       error_message = NULL,
       received_at = NOW()
     RETURNING id, processing_status`,
    [
      String(provider || "unknown"),
      sourceSystem || String(provider || "unknown"),
      eventType || null,
      eventId || null,
      eventVersion || "v1",
      schemaVersion || "v1",
      Boolean(signatureValid),
      JSON.stringify(headers || {}),
      JSON.stringify(payload || {}),
    ]
  );
  return rows[0];
}

async function processQueuedWebhooks(db, limit = 100) {
  const { rows } = await db.query(
    `SELECT id, provider, event_type, event_id, signature_valid, payload_json
     FROM loyalty_webhook_events
     WHERE processing_status = 'queued'
       AND signature_valid = true
     ORDER BY received_at ASC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await db.query("BEGIN");
      await applyWebhookEvent(db, row);
      await db.query(
        `UPDATE loyalty_webhook_events
         SET processing_status='processed', processed_at=NOW(), error_message=NULL
         WHERE id=$1`,
        [row.id]
      );
      await db.query("COMMIT");
      processed += 1;
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      await db.query(
        `UPDATE loyalty_webhook_events
         SET processing_status='failed', error_message=$2, processed_at=NOW()
         WHERE id=$1`,
        [row.id, String(e.message || e).slice(0, 500)]
      ).catch(() => {});
      failed += 1;
    }
  }
  return { queued: rows.length, processed, failed };
}

module.exports = {
  enqueueWebhook,
  processQueuedWebhooks,
};

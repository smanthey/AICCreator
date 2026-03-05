"use strict";

// Core Stripe module skeleton for OpenClaw.
// All SaaS repos should depend on these APIs instead of calling the Stripe SDK directly.

const path = require("path");
const fs = require("fs/promises");

let Stripe;
try {
  // Lazy require so environments without Stripe installed can still load the module
  // (callers will hit a clear runtime error only when they actually touch Stripe).
  // eslint-disable-next-line global-require
  Stripe = require("stripe");
} catch {
  Stripe = null;
}

const CORE_STRIPE_VERSION = "1.0.0";
const STRIPE_API_VERSION = "2024-06-20";

// Append-only audit / observability logs similar to scripts/payment-router.js
const ROOT_DIR = path.join(__dirname, "..");
const STRIPE_STATE_DIR = path.join(ROOT_DIR, "agent-state", "stripe");
const EVENTS_LOG_FILE = path.join(STRIPE_STATE_DIR, "events.jsonl");
const SUBSCRIPTIONS_LOG_FILE = path.join(STRIPE_STATE_DIR, "subscriptions.jsonl");

// In-process replay guard. Persistent idempotency should be implemented by callers
// using their own durable store keyed by event.id.
const processedEventIds = new Set();

function getStripe() {
  if (!Stripe) {
    throw new Error(
      "stripe package is not installed. Add it to your dependencies to use core/stripe."
    );
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY not set — add it to .env from Stripe Dashboard → Developers → API keys"
    );
  }
  if (!getStripe._client) {
    getStripe._client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return getStripe._client;
}

async function ensureStripeStateDir() {
  await fs.mkdir(STRIPE_STATE_DIR, { recursive: true });
}

async function appendJsonl(filePath, payload) {
  await ensureStripeStateDir();
  // Defer require to avoid loading atomic-state in environments that never log.
  // This uses the same safe-append helpers as scripts/payment-router.js.
  // eslint-disable-next-line global-require
  const { atomicAppendJSONL } = require("../control/atomic-state");
  await atomicAppendJSONL(filePath, payload);
}

function logStripe(level, message, context) {
  const base = {
    module: "core/stripe",
    level,
    message,
    ts: new Date().toISOString(),
    version: CORE_STRIPE_VERSION,
  };
  const payload = context ? { ...base, ...context } : base;
  // Use console[level] when available, default to console.log
  const logger = typeof console[level] === "function" ? console[level] : console.log;
  logger(JSON.stringify(payload));
}

// Try to delegate retries to core/queue.withRetry when available; otherwise use a
// minimal local exponential backoff implementation.
let externalWithRetry = null;
try {
  // eslint-disable-next-line global-require
  const queue = require("./queue");
  if (queue && typeof queue.withRetry === "function") {
    externalWithRetry = queue.withRetry;
  }
} catch {
  // core/queue may not be implemented yet; fallback is used instead.
}

async function runWithRetry(fn, options) {
  if (externalWithRetry) {
    return externalWithRetry(fn, options);
  }

  const maxAttempts = (options && options.maxAttempts) || 4;
  const baseDelayMs = (options && options.baseDelayMs) || 250;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt >= maxAttempts;
      logStripe("warn", "Stripe operation failed", {
        attempt,
        maxAttempts,
        error: err && err.message,
      });
      if (isLast) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      // Jitter
      const jitter = Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
}

/**
 * Record a Stripe event in the local audit log.
 * This is append-only and does not implement business-level idempotency.
 * @param {object} event
 * @param {object} [extra] - optional extra fields (e.g. outcome, correlation ids)
 * @returns {Promise<void>}
 */
async function recordStripeEvent(event, extra) {
  if (!event || !event.id) return;
  const payload = {
    event_id: event.id,
    type: event.type || null,
    created_at: event.created ? new Date(event.created * 1000).toISOString() : null,
    recorded_at: new Date().toISOString(),
    outcome: extra && extra.outcome ? extra.outcome : null,
    ...(extra || {}),
  };
  await appendJsonl(EVENTS_LOG_FILE, payload);
}

/**
 * Create a Stripe Checkout Session for one-time or subscription billing.
 * @param {object} options
 * @param {("payment"|"subscription")} [options.mode="payment"]
 * @param {string} [options.customerId] - existing Stripe customer id
 * @param {string} [options.customerEmail] - used when customerId is not provided
 * @param {Array<object>} [options.lineItems] - explicit line_items array
 * @param {Array<string>} [options.priceIds] - convenience list of price ids
 * @param {string} options.successUrl
 * @param {string} options.cancelUrl
 * @param {object} [options.metadata]
 * @param {string} [options.idempotencyKey] - used to avoid duplicate sessions
 * @returns {Promise<object>} - { id, url, mode, raw }
 */
async function createCheckoutSession(options) {
  const {
    mode = "payment",
    customerId,
    customerEmail,
    lineItems,
    priceIds,
    successUrl,
    cancelUrl,
    metadata,
    idempotencyKey,
  } = options || {};

  if (!successUrl || !cancelUrl) {
    throw new Error("createCheckoutSession requires successUrl and cancelUrl");
  }

  const stripe = getStripe();

  const sessionParams = {
    mode,
    success_url: successUrl,
    cancel_url: cancelUrl,
    automatic_payment_methods: { enabled: true },
    metadata: metadata || {},
  };

  if (customerId) {
    sessionParams.customer = customerId;
  } else if (customerEmail) {
    sessionParams.customer_email = customerEmail;
  }

  if (Array.isArray(lineItems) && lineItems.length > 0) {
    sessionParams.line_items = lineItems;
  } else if (Array.isArray(priceIds) && priceIds.length > 0) {
    sessionParams.line_items = priceIds.map((price) => ({
      price,
      quantity: 1,
    }));
  } else {
    throw new Error("createCheckoutSession requires lineItems or priceIds");
  }

  const start = Date.now();
  let session;
  try {
    session = await runWithRetry(() =>
      stripe.checkout.sessions.create(sessionParams, idempotencyKey ? { idempotencyKey } : undefined)
    );
  } catch (err) {
    logStripe("error", "createCheckoutSession failed", {
      customerId: customerId || null,
      mode,
      error: err && err.message,
    });
    throw err;
  }

  const latencyMs = Date.now() - start;
  logStripe("info", "createCheckoutSession success", {
    customerId: customerId || null,
    mode,
    session_id: session.id,
    latency_ms: latencyMs,
  });

  return {
    id: session.id,
    url: session.url,
    mode: session.mode,
    raw: session,
  };
}

/**
 * Handle incoming Stripe webhooks.
 * @param {Buffer|string} rawBody - raw HTTP request body.
 * @param {object} headers - HTTP headers, including Stripe-Signature.
 * @returns {Promise<object>} - normalized event handling result.
 */
async function handleStripeWebhook(rawBody, headers) {
  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const sigHeader =
    (headers && (headers["stripe-signature"] || headers["Stripe-Signature"])) || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

  let event;
  const start = Date.now();

  if (!webhookSecret) {
    try {
      event = JSON.parse(bodyString || "{}");
      logStripe("warn", "Stripe webhook processed without signature verification", {
        type: event && event.type,
      });
    } catch (err) {
      logStripe("error", "Stripe webhook JSON parse failed (no secret configured)", {
        error: err && err.message,
      });
      return {
        ok: false,
        status: 400,
        code: "bad_request",
        error: "Invalid JSON payload",
      };
    }
  } else {
    try {
      event = getStripe().webhooks.constructEvent(bodyString, sigHeader, webhookSecret);
    } catch (err) {
      logStripe("error", "Stripe webhook signature verification failed", {
        error: err && err.message,
      });
      return {
        ok: false,
        status: 400,
        code: "invalid_signature",
        error: "Invalid Stripe signature",
      };
    }
  }

  if (!event || !event.id) {
    return {
      ok: false,
      status: 400,
      code: "invalid_event",
      error: "Missing event id",
    };
  }

  const isReplay = processedEventIds.has(event.id);
  if (!isReplay) {
    processedEventIds.add(event.id);
  }

  const baseContext = {
    event_id: event.id,
    event_type: event.type,
    replay: isReplay,
  };

  if (isReplay) {
    logStripe("info", "Stripe webhook replay ignored (in-process idempotency)", baseContext);
    await recordStripeEvent(event, { outcome: "replay_ignored" });
    return {
      ok: true,
      status: 200,
      replay: true,
      event,
    };
  }

  // Dispatch subscription-related events to syncSubscriptionState
  const subscriptionEventTypes = new Set([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.trial_will_end",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
  ]);

  let subscriptionSyncOutcome = null;
  if (subscriptionEventTypes.has(event.type)) {
    try {
      await syncSubscriptionState(event);
      subscriptionSyncOutcome = "synced";
    } catch (err) {
      subscriptionSyncOutcome = "sync_failed";
      logStripe("error", "syncSubscriptionState failed", {
        ...baseContext,
        error: err && err.message,
      });
    }
  }

  await recordStripeEvent(event, {
    outcome: subscriptionSyncOutcome || "processed",
  });

  const latencyMs = Date.now() - start;
  logStripe("info", "Stripe webhook processed", {
    ...baseContext,
    latency_ms: latencyMs,
    subscription_sync: subscriptionSyncOutcome,
  });

  return {
    ok: true,
    status: 200,
    replay: false,
    event,
    subscriptionSyncOutcome,
  };
}

/**
 * Synchronize local subscription state in response to a Stripe event.
 * This implementation treats Stripe as the source of truth and emits
 * normalized subscription snapshots to an append-only log. Callers that
 * maintain their own subscription tables can consume this log or call
 * getCustomerActiveSubscription directly.
 * @param {object} event - Stripe event object
 * @returns {Promise<void>}
 */
async function syncSubscriptionState(event) {
  if (!event || !event.type || !event.data || !event.data.object) {
    return;
  }

  const obj = event.data.object;
  const subscriptionId = obj.id || obj.subscription || null;
  const customerId = obj.customer || null;

  const snapshot = {
    event_id: event.id,
    event_type: event.type,
    subscription_id: subscriptionId,
    customer_id: customerId,
    status: obj.status || null,
    current_period_start: obj.current_period_start
      ? new Date(obj.current_period_start * 1000).toISOString()
      : null,
    current_period_end: obj.current_period_end
      ? new Date(obj.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: Boolean(obj.cancel_at_period_end),
    created_at: obj.created ? new Date(obj.created * 1000).toISOString() : null,
    recorded_at: new Date().toISOString(),
  };

  await appendJsonl(SUBSCRIPTIONS_LOG_FILE, snapshot);
}

/**
 * Retrieve the active subscription for a given customer, if any.
 * Stripe is treated as the source of truth; callers can mirror into
 * their own DBs using the snapshots produced by syncSubscriptionState.
 * @param {string} customerId
 * @returns {Promise<object|null>}
 */
async function getCustomerActiveSubscription(customerId) {
  if (!customerId) {
    throw new Error("getCustomerActiveSubscription requires customerId");
  }
  const stripe = getStripe();

  const start = Date.now();
  let list;
  try {
    list = await runWithRetry(() =>
      stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        expand: ["data.default_payment_method"],
        limit: 50,
      })
    );
  } catch (err) {
    logStripe("error", "getCustomerActiveSubscription failed", {
      customerId,
      error: err && err.message,
    });
    throw err;
  }

  const latencyMs = Date.now() - start;

  const ordered = (list && Array.isArray(list.data) ? list.data : []).slice().sort((a, b) => {
    const tsA = a.current_period_end || 0;
    const tsB = b.current_period_end || 0;
    return tsB - tsA;
  });

  const active = ordered.find((sub) =>
    ["trialing", "active", "past_due", "unpaid"].includes(sub.status)
  );

  logStripe("info", "getCustomerActiveSubscription result", {
    customerId,
    has_active: Boolean(active),
    subscription_id: active ? active.id : null,
    latency_ms: latencyMs,
  });

  return active || null;
}

/**
 * Cancel a subscription in Stripe and update local state.
 * @param {string} subscriptionId
 * @param {object} [options]
 * @param {boolean} [options.cancelAtPeriodEnd=true]
 * @returns {Promise<object>} - updated subscription object
 */
async function cancelSubscription(subscriptionId, options) {
  if (!subscriptionId) {
    throw new Error("cancelSubscription requires subscriptionId");
  }
  const { cancelAtPeriodEnd = true } = options || {};

  const stripe = getStripe();
  const start = Date.now();

  let updated;
  try {
    updated = await runWithRetry(() =>
      stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      })
    );
  } catch (err) {
    logStripe("error", "cancelSubscription failed", {
      subscription_id: subscriptionId,
      error: err && err.message,
    });
    throw err;
  }

  const latencyMs = Date.now() - start;
  logStripe("info", "cancelSubscription success", {
    subscription_id: subscriptionId,
    cancel_at_period_end: cancelAtPeriodEnd,
    status: updated.status,
    latency_ms: latencyMs,
  });

  // Also record to the Stripe events log as an operational event (no event.id here)
  await recordStripeEvent(
    {
      id: `manual_cancel_${subscriptionId}_${Date.now()}`,
      type: "core.subscription.cancel",
      created: Math.floor(Date.now() / 1000),
    },
    {
      outcome: "processed",
      subscription_id: subscriptionId,
    }
  );

  return updated;
}

exports.CORE_STRIPE_VERSION = CORE_STRIPE_VERSION;
exports.createCheckoutSession = createCheckoutSession;
exports.handleStripeWebhook = handleStripeWebhook;
exports.syncSubscriptionState = syncSubscriptionState;
exports.getCustomerActiveSubscription = getCustomerActiveSubscription;
exports.cancelSubscription = cancelSubscription;
exports.recordStripeEvent = recordStripeEvent;


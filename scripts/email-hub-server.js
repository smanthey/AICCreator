#!/usr/bin/env node
"use strict";

const http = require("http");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { URL } = require("url");
const { sendEmail } = require("../core/email");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const PORT = Number(process.env.EMAIL_HUB_PORT || 4045);
const HOST = String(process.env.EMAIL_HUB_HOST || "127.0.0.1").trim();
const ALLOW_WILDCARD_BIND = String(process.env.EMAIL_HUB_ALLOW_WILDCARD_BIND || "").trim() === "true";
const API_KEY = String(process.env.EMAIL_HUB_API_KEY || "").trim();
const MAILEROO_SECRET = String(process.env.MAILEROO_WEBHOOK_SECRET || "").trim();
const RESEND_SECRET = String(process.env.RESEND_WEBHOOK_SECRET || "").trim();
const FORWARD_URLS = String(process.env.EMAIL_HUB_FORWARD_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ROOT = path.join(__dirname, "..");
const STATE_DIR = path.join(ROOT, "agent-state", "email-hub");
const EVENTS_FILE = path.join(STATE_DIR, "events.jsonl");
const FLOWS_FILE = path.join(STATE_DIR, "flows.json");
const METRICS_FILE = path.join(STATE_DIR, "metrics.json");
const DASHBOARD_FILE = path.join(ROOT, "dashboard", "email-hub", "index.html");

function nowIso() {
  return new Date().toISOString();
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function timingSafeHexEq(a, b) {
  try {
    const aa = Buffer.from(String(a || "").replace(/^sha256=/i, ""), "hex");
    const bb = Buffer.from(String(b || "").replace(/^sha256=/i, ""), "hex");
    if (!aa.length || !bb.length || aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function verifyHmacSha256(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeHexEq(signatureHeader, expected);
}

function authed(req) {
  if (!API_KEY) return true;
  const auth = String(req.headers.authorization || "");
  return auth === `Bearer ${API_KEY}`;
}

async function ensureState() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  if (!existsSync(FLOWS_FILE)) {
    await fs.writeFile(FLOWS_FILE, JSON.stringify({ version: 1, flows: [] }, null, 2));
  }
  if (!existsSync(METRICS_FILE)) {
    await fs.writeFile(
      METRICS_FILE,
      JSON.stringify(
        {
          createdAt: nowIso(),
          sendAttempts: 0,
          sendSuccess: 0,
          sendFailed: 0,
          webhookEvents: 0,
          forwardedEvents: 0,
          lastEventAt: null,
        },
        null,
        2
      )
    );
  }
}

async function appendJsonl(file, payload) {
  await ensureState();
  const line = `${JSON.stringify(payload)}\n`;
  await fs.appendFile(file, line, "utf8");
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, payload) {
  await ensureState();
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}

async function updateMetrics(patch) {
  const current = await readJson(METRICS_FILE, {
    createdAt: nowIso(),
    sendAttempts: 0,
    sendSuccess: 0,
    sendFailed: 0,
    webhookEvents: 0,
    forwardedEvents: 0,
    lastEventAt: null,
  });
  const next = { ...current, ...patch, updatedAt: nowIso() };
  await writeJson(METRICS_FILE, next);
  return next;
}

async function readEvents(limit = 200, filters = {}) {
  try {
    const raw = await fs.readFile(EVENTS_FILE, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse()
      .filter((evt) => {
        if (filters.site && String(evt.site || "") !== String(filters.site)) return false;
        if (filters.type && String(evt.type || "") !== String(filters.type)) return false;
        return true;
      })
      .slice(0, limit);
    return parsed;
  } catch {
    return [];
  }
}

function summarizeEvents(events) {
  const bySite = {};
  const byType = {};
  const byProvider = {};

  for (const evt of events) {
    const site = String(evt.site || "unknown");
    const type = String(evt.type || "unknown");
    const provider = String(evt.provider || "unknown");

    bySite[site] = (bySite[site] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
    byProvider[provider] = (byProvider[provider] || 0) + 1;
  }

  const top = (obj) =>
    Object.entries(obj)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 20)
      .map(([key, count]) => ({ key, count }));

  const kpiBySite = {};
  const classifyKpi = (type) => {
    const t = String(type || "").toLowerCase();
    if (
      t.includes(".delivered") ||
      t.endsWith("email.delivered") ||
      t.includes("delivered")
    ) {
      return "delivered";
    }
    if (t.includes(".opened") || t.includes(".open") || t.includes("opened")) {
      return "opened";
    }
    if (t.includes(".clicked") || t.includes(".click") || t.includes("clicked")) {
      return "clicked";
    }
    if (
      t.includes(".bounce") ||
      t.includes("bounced") ||
      t.includes("failed") ||
      t.includes("email.failed")
    ) {
      return "failed";
    }
    return null;
  };

  for (const evt of events) {
    const site = String(evt.site || "unknown");
    if (!kpiBySite[site]) {
      kpiBySite[site] = { delivered: 0, opened: 0, clicked: 0, failed: 0 };
    }
    const bucket = classifyKpi(evt.type);
    if (bucket) {
      kpiBySite[site][bucket] += 1;
    }
  }

  return {
    total: events.length,
    bySite: top(bySite),
    byType: top(byType),
    byProvider: top(byProvider),
    kpiBySite,
  };
}

function validateFlow(body) {
  const errors = [];
  if (!body?.id) errors.push("id is required");
  if (!body?.name) errors.push("name is required");
  if (!body?.trigger) errors.push("trigger is required");
  if (!Array.isArray(body?.actions)) errors.push("actions must be an array");

  if (Array.isArray(body?.actions)) {
    body.actions.forEach((action, index) => {
      if (!action || typeof action !== "object") {
        errors.push(`actions[${index}] must be an object`);
        return;
      }
      if (!action.type) {
        errors.push(`actions[${index}].type is required`);
        return;
      }

      if (action.type === "webhook") {
        if (!action.url) errors.push(`actions[${index}].url is required for webhook`);
        if (action.url && !/^https?:\/\//i.test(String(action.url))) {
          errors.push(`actions[${index}].url must start with http:// or https://`);
        }
      }

      if (action.type === "send_email") {
        if (!action.to) errors.push(`actions[${index}].to is required for send_email`);
        if (!action.fromEmail && !process.env.EMAIL_HUB_DEFAULT_FROM_EMAIL) {
          errors.push(
            `actions[${index}].fromEmail is required when EMAIL_HUB_DEFAULT_FROM_EMAIL is not set`
          );
        }
        if (!action.subject) errors.push(`actions[${index}].subject is required for send_email`);
      }
    });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeMailerooEvent(raw) {
  const data = raw && typeof raw.data === "object" ? raw.data : {};
  const event = String(
    raw?.event || raw?.type || data?.event || data?.type || raw?.event_type || data?.event_type || "unknown"
  ).toLowerCase();
  return {
    provider: "maileroo",
    event,
    messageId: raw?.message_id || raw?.maileroo_id || data?.message_id || data?.id || raw?.id || null,
    recipient: raw?.to || raw?.recipient || raw?.email || data?.to || data?.recipient || data?.email || null,
    subject: raw?.subject || data?.subject || null,
    url: raw?.url || data?.url || data?.link || null,
    bounceType: raw?.bounce_type || data?.bounce_type || data?.reason || null,
    raw,
  };
}

function normalizeResendEvent(raw) {
  const data = raw?.data || raw || {};
  const type = String(raw?.type || raw?.event || data?.type || "unknown").toLowerCase();
  return {
    provider: "resend",
    event: type,
    messageId: data?.email_id || data?.id || raw?.id || null,
    recipient: data?.to || data?.email || null,
    subject: data?.subject || null,
    url: data?.url || null,
    bounceType: data?.bounce_type || data?.reason || null,
    raw,
  };
}

async function postJson(url, payload, headers = {}) {
  const u = new URL(url);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body, "utf8"),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode || 0, body: text });
        });
      }
    );
    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

async function forwardEvent(event) {
  if (!FORWARD_URLS.length) return [];
  const results = [];
  for (const url of FORWARD_URLS) {
    try {
      const res = await postJson(url, event, {
        "x-email-hub-event": event.type,
      });
      results.push({ url, ok: res.status >= 200 && res.status < 300, status: res.status });
    } catch (error) {
      results.push({ url, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await updateMetrics({ forwardedEvents: (await readJson(METRICS_FILE, { forwardedEvents: 0 })).forwardedEvents + results.filter((r) => r.ok).length });
  return results;
}

function flowMatches(flow, event) {
  if (!flow.enabled) return false;
  if (flow.trigger !== event.type && flow.trigger !== `${event.provider}.${event.event}`) return false;
  const cond = flow.conditions || {};
  if (cond.site && String(cond.site) !== String(event.site || "")) return false;
  if (cond.recipientIncludes) {
    const r = String(event.recipient || "").toLowerCase();
    if (!r.includes(String(cond.recipientIncludes).toLowerCase())) return false;
  }
  return true;
}

function interpolate(template, event) {
  return String(template || "")
    .replace(/\{\{event\}\}/g, String(event.event || ""))
    .replace(/\{\{recipient\}\}/g, String(event.recipient || ""))
    .replace(/\{\{subject\}\}/g, String(event.subject || ""))
    .replace(/\{\{site\}\}/g, String(event.site || ""));
}

async function executeFlow(flow, event) {
  const actions = Array.isArray(flow.actions) ? flow.actions : [];
  const actionResults = [];
  for (const action of actions) {
    if (action.type === "webhook" && action.url) {
      try {
        const res = await postJson(action.url, { flowId: flow.id, event });
        actionResults.push({ type: action.type, ok: res.status >= 200 && res.status < 300, status: res.status });
      } catch (error) {
        actionResults.push({ type: action.type, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }

    if (action.type === "send_email") {
      try {
        const payload = {
          to: action.to || event.recipient,
          subject: interpolate(action.subject || "Email Hub Flow", event),
          html: interpolate(action.html || "", event) || undefined,
          text: interpolate(action.text || "", event) || undefined,
          fromName: action.fromName,
          fromEmail: action.fromEmail || process.env.EMAIL_HUB_DEFAULT_FROM_EMAIL,
          provider: action.provider,
          correlationId: `flow_${flow.id}_${Date.now()}`,
        };
        if (!payload.to || !payload.fromEmail) {
          actionResults.push({ type: action.type, ok: false, error: "missing to/fromEmail" });
        } else {
          const sent = await sendEmail(payload);
          actionResults.push({ type: action.type, ok: true, provider: sent.provider, messageId: sent.messageId });
        }
      } catch (error) {
        actionResults.push({ type: action.type, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await appendJsonl(EVENTS_FILE, {
    id: crypto.randomUUID(),
    ts: nowIso(),
    type: "flow.executed",
    flowId: flow.id,
    eventType: event.type,
    provider: event.provider,
    site: event.site || null,
    actionResults,
  });

  return actionResults;
}

async function applyFlows(event) {
  const flowDoc = await readJson(FLOWS_FILE, { version: 1, flows: [] });
  const matches = (flowDoc.flows || []).filter((f) => flowMatches(f, event));
  const results = [];
  for (const flow of matches) {
    // eslint-disable-next-line no-await-in-loop
    const actionResults = await executeFlow(flow, event);
    results.push({ flowId: flow.id, actionResults });
  }
  return results;
}

function parseJson(raw, fallback = {}) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function dashboardHtmlFallback() {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Email Hub Dashboard</title></head><body><h1>Email Hub Dashboard</h1><p>Dashboard file missing. Create dashboard/email-hub/index.html</p></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  if (req.method === "GET" && pathname === "/api/email-hub/health") {
    const metrics = await readJson(METRICS_FILE, null);
    return json(res, 200, {
      ok: true,
      service: "email-hub",
      ts: nowIso(),
      flowsConfigured: (await readJson(FLOWS_FILE, { flows: [] })).flows.length,
      apiKeyProtected: Boolean(API_KEY),
      forwardsConfigured: FORWARD_URLS.length,
      metrics,
    });
  }

  if (req.method === "GET" && pathname === "/email-hub/dashboard") {
    try {
      const html = await fs.readFile(DASHBOARD_FILE, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(dashboardHtmlFallback());
    }
    return;
  }

  if (pathname.startsWith("/api/email-hub/v1/") && !authed(req) && !pathname.includes("/webhooks/")) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  if (req.method === "GET" && pathname === "/api/email-hub/v1/events") {
    const limit = Math.max(1, Math.min(1000, Number(reqUrl.searchParams.get("limit") || 200)));
    const site = reqUrl.searchParams.get("site") || undefined;
    const type = reqUrl.searchParams.get("type") || undefined;
    const events = await readEvents(limit, { site, type });
    return json(res, 200, { ok: true, count: events.length, events });
  }

  if (req.method === "GET" && pathname === "/api/email-hub/v1/analytics/summary") {
    const limit = Math.max(1, Math.min(10000, Number(reqUrl.searchParams.get("limit") || 2000)));
    const site = reqUrl.searchParams.get("site") || undefined;
    const events = await readEvents(limit, { site });
    return json(res, 200, { ok: true, summary: summarizeEvents(events) });
  }

  if (req.method === "GET" && pathname === "/api/email-hub/v1/flows") {
    const flowDoc = await readJson(FLOWS_FILE, { version: 1, flows: [] });
    return json(res, 200, { ok: true, ...flowDoc });
  }

  if (req.method === "POST" && pathname === "/api/email-hub/v1/flows") {
    const raw = await readRawBody(req);
    const body = parseJson(raw, {});
    const validation = validateFlow(body);
    if (!validation.ok) {
      return json(res, 400, { ok: false, error: "invalid_flow", details: validation.errors });
    }

    const flowDoc = await readJson(FLOWS_FILE, { version: 1, flows: [] });
    const currentFlows = Array.isArray(flowDoc.flows) ? flowDoc.flows : [];
    const normalized = {
      id: String(body.id),
      name: String(body.name),
      trigger: String(body.trigger),
      enabled: body.enabled !== false,
      site: body.site ? String(body.site) : null,
      conditions: body.conditions || {},
      actions: Array.isArray(body.actions) ? body.actions : [],
      updatedAt: nowIso(),
    };

    const idx = currentFlows.findIndex((f) => f.id === normalized.id);
    if (idx >= 0) currentFlows[idx] = { ...currentFlows[idx], ...normalized };
    else currentFlows.push({ ...normalized, createdAt: nowIso() });

    await writeJson(FLOWS_FILE, { version: 1, flows: currentFlows });
    await appendJsonl(EVENTS_FILE, {
      id: crypto.randomUUID(),
      ts: nowIso(),
      type: "flow.saved",
      flowId: normalized.id,
      site: normalized.site,
      trigger: normalized.trigger,
    });

    return json(res, 200, { ok: true, flow: normalized });
  }

  if (req.method === "POST" && pathname === "/api/email-hub/v1/flows/validate") {
    const raw = await readRawBody(req);
    const body = parseJson(raw, {});
    const validation = validateFlow(body);
    return json(res, validation.ok ? 200 : 400, {
      ok: validation.ok,
      errors: validation.errors,
    });
  }

  if (req.method === "POST" && pathname === "/api/email-hub/v1/send") {
    const raw = await readRawBody(req);
    const body = parseJson(raw, {});

    const required = ["to", "subject", "fromEmail"];
    const missing = required.filter((k) => !body?.[k]);
    if (missing.length) {
      return json(res, 400, { ok: false, error: `missing fields: ${missing.join(", ")}` });
    }

    const site = body.site ? String(body.site) : null;
    const eventBase = {
      id: crypto.randomUUID(),
      ts: nowIso(),
      site,
      provider: body.provider || null,
      to: body.to,
      subject: body.subject,
    };

    await updateMetrics({
      sendAttempts: (await readJson(METRICS_FILE, { sendAttempts: 0 })).sendAttempts + 1,
      lastEventAt: nowIso(),
    });

    try {
      const result = await sendEmail({
        to: body.to,
        subject: body.subject,
        html: body.html,
        text: body.text,
        fromName: body.fromName,
        fromEmail: body.fromEmail,
        provider: body.provider,
        brand: body.brand,
        correlationId: body.correlationId,
      });

      const sentEvt = {
        ...eventBase,
        type: "email.sent",
        status: result.status,
        messageId: result.messageId,
        usedProvider: result.provider,
      };
      await appendJsonl(EVENTS_FILE, sentEvt);
      await updateMetrics({
        sendSuccess: (await readJson(METRICS_FILE, { sendSuccess: 0 })).sendSuccess + 1,
        lastEventAt: nowIso(),
      });

      await forwardEvent(sentEvt);
      await applyFlows({
        type: "email.sent",
        event: "sent",
        provider: result.provider || "unknown",
        recipient: Array.isArray(body.to) ? body.to[0] : body.to,
        subject: body.subject,
        site,
      });

      return json(res, 200, { ok: true, result });
    } catch (error) {
      const failedEvt = {
        ...eventBase,
        type: "email.failed",
        error: error instanceof Error ? error.message : String(error),
      };
      await appendJsonl(EVENTS_FILE, failedEvt);
      await updateMetrics({
        sendFailed: (await readJson(METRICS_FILE, { sendFailed: 0 })).sendFailed + 1,
        lastEventAt: nowIso(),
      });
      await forwardEvent(failedEvt);
      return json(res, 502, { ok: false, error: failedEvt.error });
    }
  }

  if (req.method === "POST" && pathname === "/api/email-hub/v1/trigger") {
    const raw = await readRawBody(req);
    const body = parseJson(raw, {});
    if (!body?.type) return json(res, 400, { ok: false, error: "type required" });

    const event = {
      id: crypto.randomUUID(),
      ts: nowIso(),
      type: String(body.type),
      event: String(body.event || body.type),
      provider: String(body.provider || "custom"),
      recipient: body.recipient || null,
      subject: body.subject || null,
      site: body.site || null,
      payload: body.payload || null,
    };

    await appendJsonl(EVENTS_FILE, event);
    await forwardEvent(event);
    const flowResults = await applyFlows(event);
    return json(res, 200, { ok: true, event, flowResults });
  }

  if (req.method === "POST" && pathname === "/api/email-hub/v1/webhooks/maileroo") {
    const raw = await readRawBody(req);
    const sig = String(req.headers["x-maileroo-signature"] || "");
    if (!verifyHmacSha256(raw, sig, MAILEROO_SECRET)) {
      return json(res, 401, { ok: false, error: "invalid signature" });
    }

    const payload = parseJson(raw, {});
    const normalized = normalizeMailerooEvent(payload);
    const event = {
      id: crypto.randomUUID(),
      ts: nowIso(),
      type: `maileroo.${normalized.event}`,
      event: normalized.event,
      provider: "maileroo",
      recipient: normalized.recipient,
      subject: normalized.subject,
      messageId: normalized.messageId,
      bounceType: normalized.bounceType,
      site: payload.site || null,
      payload: normalized.raw,
    };

    await appendJsonl(EVENTS_FILE, event);
    await updateMetrics({
      webhookEvents: (await readJson(METRICS_FILE, { webhookEvents: 0 })).webhookEvents + 1,
      lastEventAt: nowIso(),
    });
    await forwardEvent(event);
    const flowResults = await applyFlows(event);
    return json(res, 200, { ok: true, event, flowResults });
  }

  if (req.method === "POST" && pathname === "/api/email-hub/v1/webhooks/resend") {
    const raw = await readRawBody(req);
    const sig = String(req.headers["x-resend-signature"] || req.headers["svix-signature"] || "");
    if (!verifyHmacSha256(raw, sig, RESEND_SECRET)) {
      return json(res, 401, { ok: false, error: "invalid signature" });
    }

    const payload = parseJson(raw, {});
    const normalized = normalizeResendEvent(payload);
    const event = {
      id: crypto.randomUUID(),
      ts: nowIso(),
      type: `resend.${normalized.event}`,
      event: normalized.event,
      provider: "resend",
      recipient: normalized.recipient,
      subject: normalized.subject,
      messageId: normalized.messageId,
      bounceType: normalized.bounceType,
      site: payload.site || null,
      payload: normalized.raw,
    };

    await appendJsonl(EVENTS_FILE, event);
    await updateMetrics({
      webhookEvents: (await readJson(METRICS_FILE, { webhookEvents: 0 })).webhookEvents + 1,
      lastEventAt: nowIso(),
    });
    await forwardEvent(event);
    const flowResults = await applyFlows(event);
    return json(res, 200, { ok: true, event, flowResults });
  }

  return json(res, 404, { ok: false, error: "not_found" });
});

ensureState()
  .then(() => {
    if (HOST === "0.0.0.0" && !ALLOW_WILDCARD_BIND) {
      throw new Error(
        "Refusing wildcard bind. Set EMAIL_HUB_HOST=127.0.0.1 (recommended) or EMAIL_HUB_ALLOW_WILDCARD_BIND=true to override."
      );
    }
    server.listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(`[email-hub] listening on ${HOST}:${PORT}`);
      // eslint-disable-next-line no-console
      console.log(`[email-hub] dashboard: http://127.0.0.1:${PORT}/email-hub/dashboard`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[email-hub] failed to initialize", error);
    process.exit(1);
  });

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

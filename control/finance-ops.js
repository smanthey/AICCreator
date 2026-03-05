"use strict";

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const { getGmail } = require("../infra/gmail-client");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const TAX_ROOT_DEFAULT = path.join(ROOT, "taxes");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function toDateISO(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function normalizeProvider(name) {
  return safeLower(name)
    .replace(/\b(inc|llc|corp|ltd|co|company|payments?|subscription|recurring|invoice)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "unknown-provider";
}

function cycleToMonthlyCost(amount, cycle) {
  const a = Number(amount || 0);
  const c = safeLower(cycle);
  if (!a || a < 0) return 0;
  if (c.includes("year")) return a / 12;
  if (c.includes("week")) return a * 4.333;
  if (c.includes("day")) return a * 30;
  if (c.includes("quarter")) return a / 3;
  return a;
}

function addCycle(dateIso, cycle) {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const c = safeLower(cycle);
  if (c.includes("year")) d.setFullYear(d.getFullYear() + 1);
  else if (c.includes("week")) d.setDate(d.getDate() + 7);
  else if (c.includes("day")) d.setDate(d.getDate() + 1);
  else if (c.includes("quarter")) d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return toDateISO(d);
}

function extractEmail(headers, key) {
  const h = (headers || []).find((x) => safeLower(x.name) === safeLower(key));
  return h ? String(h.value || "") : "";
}

function parseMoney(text) {
  const t = String(text || "");
  const m = t.match(/\$\s?([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (!m) return null;
  return Number(String(m[1]).replace(/,/g, ""));
}

function detectCycle(text) {
  const t = safeLower(text);
  if (/annually|yearly|per year|every year/.test(t)) return "yearly";
  if (/weekly|per week|every week/.test(t)) return "weekly";
  if (/daily|per day|every day/.test(t)) return "daily";
  if (/quarterly|every 3 months/.test(t)) return "quarterly";
  return "monthly";
}

function classifyTaxCategory(vendorOrText) {
  const t = safeLower(vendorOrText);
  if (/(hospital|clinic|pharmacy|medical|dental|health)/.test(t)) return { category: "medical", deductible: true };
  if (/(charity|donation|church|foundation|nonprofit|non-profit)/.test(t)) return { category: "charitable", deductible: true };
  if (/(software|saas|hosting|cloud|openai|anthropic|google|adobe|figma|notion|slack|zoom|github)/.test(t)) return { category: "business_software", deductible: true };
  if (/(office|staples|printer|supplies|ups|fedex)/.test(t)) return { category: "business_supplies", deductible: true };
  if (/(airlines|uber|lyft|hotel|travel|flight)/.test(t)) return { category: "business_travel", deductible: true };
  return { category: "other", deductible: false };
}

function detectDocType(text) {
  const t = safeLower(text);
  if (/\b1099\b/.test(t)) return "1099";
  if (/\bw-?2\b/.test(t)) return "W-2";
  if (/\b1098\b/.test(t)) return "1098";
  if (/tax form|tax document/.test(t)) return "tax_document";
  return "unknown_income_doc";
}

async function ensureSchema() {
  const pg = require("../infra/postgres");
  // Check if migration has been applied
  const { rows } = await pg.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'finance_subscriptions'
    ) as exists
  `);
  
  if (!rows[0].exists) {
    throw new Error('Migration 071 must be applied first. Run: node scripts/run-migrations.js --only 071');
  }
}

function plaidBaseUrl() {
  const env = safeLower(process.env.PLAID_ENV || "production");
  if (env === "sandbox") return "https://sandbox.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://production.plaid.com";
}

async function plaidPost(endpoint, body) {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret || !process.env.PLAID_ACCESS_TOKEN) {
    return { ok: false, error: "plaid_env_missing", data: null };
  }

  const url = `${plaidBaseUrl()}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      access_token: process.env.PLAID_ACCESS_TOKEN,
      ...body,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error_message || `http_${res.status}`, data };
  }
  return { ok: true, data };
}

async function fetchPlaidTransactions(daysBack = 180) {
  const end = new Date();
  const start = new Date(Date.now() - daysBack * 86400000);
  const all = [];
  let offset = 0;
  const count = 200;

  while (offset < 2000) {
    const r = await plaidPost("/transactions/get", {
      start_date: toDateISO(start),
      end_date: toDateISO(end),
      options: { count, offset },
    });
    if (!r.ok) return r;
    const tx = Array.isArray(r.data?.transactions) ? r.data.transactions : [];
    all.push(...tx);
    const total = Number(r.data?.total_transactions || tx.length);
    offset += tx.length;
    if (!tx.length || offset >= total) break;
  }

  return { ok: true, data: { transactions: all } };
}

async function fetchPlaidRecurring() {
  const r = await plaidPost("/transactions/recurring/get", {});
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      inflow_streams: r.data?.inflow_streams || [],
      outflow_streams: r.data?.outflow_streams || [],
    },
  };
}

async function listGmailMessages(query, maxResults = 100) {
  let gmail;
  try {
    gmail = getGmail();
  } catch (e) {
    return { ok: false, error: e.message, messages: [] };
  }

  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  const msgs = list.data.messages || [];
  const out = [];

  for (const m of msgs) {
    const g = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });
    const headers = g.data.payload?.headers || [];
    out.push({
      id: g.data.id,
      threadId: g.data.threadId,
      snippet: g.data.snippet || "",
      internalDate: Number(g.data.internalDate || Date.now()),
      subject: extractEmail(headers, "Subject"),
      from: extractEmail(headers, "From"),
      to: extractEmail(headers, "To"),
      dateHeader: extractEmail(headers, "Date"),
    });
  }

  return { ok: true, messages: out };
}

function groupChargesByProvider(charges) {
  const by = new Map();
  for (const c of charges) {
    const name = c.merchant_name || c.name || "Unknown";
    const key = normalizeProvider(name);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push({
      provider_key: key,
      display_name: name,
      amount_usd: Number(c.amount || 0),
      charge_date: c.date,
      currency: c.iso_currency_code || "USD",
      external_id: c.transaction_id || null,
      source: "plaid_transactions",
      metadata: c,
    });
  }
  return by;
}

function inferCycleFromDates(dates) {
  if (!dates || dates.length < 2) return "monthly";
  const ds = dates.map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  if (ds.length < 2) return "monthly";
  const diffs = [];
  for (let i = 1; i < ds.length; i += 1) diffs.push((ds[i] - ds[i - 1]) / 86400000);
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  if (avg > 300) return "yearly";
  if (avg < 10) return "weekly";
  if (avg > 70 && avg < 120) return "quarterly";
  return "monthly";
}

function detectPriceIncrease(amounts) {
  if (!amounts || amounts.length < 3) return false;
  const vals = [...amounts].map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (vals.length < 3) return false;
  const latest = vals[vals.length - 1];
  const prior = vals.slice(0, -1);
  const avgPrior = prior.reduce((a, b) => a + b, 0) / prior.length;
  return latest > avgPrior * 1.1;
}

function detectDuplicates(subs) {
  const groups = new Map();
  for (const s of subs) {
    const base = s.provider_key.replace(/-(plus|pro|premium|team|business)$/, "");
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(s);
  }
  const dup = new Set();
  for (const [g, arr] of groups) {
    if (arr.length > 1) arr.forEach((s) => dup.add(`${g}:${s.provider_key}`));
  }
  return dup;
}

async function saveSubscriptionCharges(charges, dryRun) {
  if (dryRun) return;
  for (const c of charges) {
    await pg.query(
      `INSERT INTO finance_subscription_charges
        (provider_key, charge_date, amount_usd, currency, merchant_name, source, external_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (source, external_id) DO NOTHING`,
      [c.provider_key, c.charge_date, c.amount_usd, c.currency, c.display_name, c.source, c.external_id, JSON.stringify(c.metadata || {})]
    );
  }
}

async function upsertSubscriptions(subs, dryRun) {
  if (dryRun) return;
  for (const s of subs) {
    await pg.query(
      `INSERT INTO finance_subscriptions
        (provider_key, display_name, amount_usd, billing_cycle, renewal_date, last_charge_date, monthly_cost_usd, source, duplicate_group, unused_30d, price_increase_detected, is_active, notes, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13::jsonb)
       ON CONFLICT (provider_key, source)
       DO UPDATE SET
         display_name=EXCLUDED.display_name,
         amount_usd=EXCLUDED.amount_usd,
         billing_cycle=EXCLUDED.billing_cycle,
         renewal_date=EXCLUDED.renewal_date,
         last_charge_date=EXCLUDED.last_charge_date,
         monthly_cost_usd=EXCLUDED.monthly_cost_usd,
         duplicate_group=EXCLUDED.duplicate_group,
         unused_30d=EXCLUDED.unused_30d,
         price_increase_detected=EXCLUDED.price_increase_detected,
         notes=EXCLUDED.notes,
         metadata=EXCLUDED.metadata,
         updated_at=NOW()`,
      [
        s.provider_key,
        s.display_name,
        s.amount_usd,
        s.billing_cycle,
        s.renewal_date,
        s.last_charge_date,
        s.monthly_cost_usd,
        s.source,
        s.duplicate_group,
        s.unused_30d,
        s.price_increase_detected,
        s.notes || null,
        JSON.stringify(s.metadata || {}),
      ]
    );
  }
}

async function insertAlerts(alerts, dryRun) {
  if (dryRun) return;
  for (const a of alerts) {
    await pg.query(
      `INSERT INTO finance_alerts (alert_type, provider_key, due_date, status, payload)
       VALUES ($1,$2,$3,'open',$4::jsonb)`,
      [a.alert_type, a.provider_key || null, a.due_date || null, JSON.stringify(a.payload || {})]
    );
  }
}

async function saveUsageSignals(signals, dryRun) {
  if (dryRun) return;
  for (const s of signals) {
    await pg.query(
      `INSERT INTO finance_usage_signals (provider_key, signal_date, signal_type, source, message_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (source, message_id) DO NOTHING`,
      [s.provider_key, s.signal_date, s.signal_type, s.source, s.message_id || null, JSON.stringify(s.metadata || {})]
    );
  }
}

function buildCutRecommendations(subs) {
  const out = [];
  for (const s of subs) {
    if (s.unused_30d) out.push({ provider_key: s.provider_key, reason: "No usage signal in 30+ days" });
    if (s.price_increase_detected) out.push({ provider_key: s.provider_key, reason: "Recent price increase detected" });
    if (s.duplicate_group) out.push({ provider_key: s.provider_key, reason: `Potential duplicate service group: ${s.duplicate_group}` });
  }
  return out;
}

function dedupeByProvider(items) {
  const m = new Map();
  for (const i of items) m.set(i.provider_key, i);
  return [...m.values()];
}

async function runSubscriptionAudit(opts = {}) {
  await ensureSchema();
  ensureDir(REPORT_DIR);

  const daysBack = Math.max(30, Math.min(730, Number(opts.days_back || 180)));
  const maxEmailScan = Math.max(10, Math.min(500, Number(opts.max_email_scan || 120)));
  const dryRun = Boolean(opts.dry_run);

  const warnings = [];
  const charges = [];
  const usageSignals = [];

  const plaidTx = await fetchPlaidTransactions(daysBack);
  const recurring = await fetchPlaidRecurring();

  if (!plaidTx.ok) warnings.push(`plaid_transactions: ${plaidTx.error}`);
  if (!recurring.ok) warnings.push(`plaid_recurring: ${recurring.error}`);

  if (plaidTx.ok) {
    const grouped = groupChargesByProvider(plaidTx.data.transactions || []);
    for (const arr of grouped.values()) charges.push(...arr);
  }

  const subscriptionEmails = await listGmailMessages("(subscription OR renewal OR invoice OR receipt OR billed) newer_than:365d", maxEmailScan);
  if (!subscriptionEmails.ok) warnings.push(`gmail_subscription_scan: ${subscriptionEmails.error}`);

  const providersFromEmail = new Map();
  if (subscriptionEmails.ok) {
    for (const m of subscriptionEmails.messages) {
      const subject = `${m.subject || ""} ${m.snippet || ""}`;
      const amount = parseMoney(subject);
      const cycle = detectCycle(subject);
      const name = m.from?.split("<")[0]?.replace(/"/g, "").trim() || m.subject || "Email Provider";
      const key = normalizeProvider(name);
      const signalType = /(login|activity|usage|weekly report|monthly report|new sign-in)/i.test(subject)
        ? "usage"
        : "billing_email";

      usageSignals.push({
        provider_key: key,
        signal_date: new Date(m.internalDate || Date.now()).toISOString(),
        signal_type: signalType,
        source: "gmail",
        message_id: m.id,
        metadata: { subject: m.subject, from: m.from, snippet: m.snippet },
      });

      if (!providersFromEmail.has(key)) {
        providersFromEmail.set(key, {
          provider_key: key,
          display_name: name,
          amount_usd: amount,
          billing_cycle: cycle,
          renewal_date: addCycle(toDateISO(m.internalDate), cycle),
          last_charge_date: toDateISO(m.internalDate),
          source: "gmail_derived",
          metadata: { sample_subject: m.subject, from: m.from },
        });
      }
    }
  }

  await saveUsageSignals(usageSignals, dryRun);
  await saveSubscriptionCharges(charges, dryRun);

  const byProviderCharges = new Map();
  for (const c of charges) {
    if (!byProviderCharges.has(c.provider_key)) byProviderCharges.set(c.provider_key, []);
    byProviderCharges.get(c.provider_key).push(c);
  }

  const recurringOutflow = recurring.ok ? recurring.data.outflow_streams || [] : [];
  const recurringByProvider = new Map();
  for (const r of recurringOutflow) {
    const name = r.merchant_name || r.description || r.stream_id || "Recurring Provider";
    const key = normalizeProvider(name);
    recurringByProvider.set(key, {
      provider_key: key,
      display_name: name,
      amount_usd: Number(r.last_amount?.amount || r.average_amount?.amount || r.amount || 0),
      billing_cycle: safeLower(r.frequency || r.interval || "monthly"),
      last_charge_date: toDateISO(r.last_date || r.last_transaction_date),
      renewal_date: addCycle(toDateISO(r.last_date || r.last_transaction_date), r.frequency || r.interval || "monthly"),
      source: "plaid_recurring",
      metadata: r,
    });
  }

  const providers = new Map();

  // Merge all signals into final subscription list
  for (const [k, v] of recurringByProvider.entries()) providers.set(k, v);

  for (const [k, arr] of byProviderCharges.entries()) {
    const dates = arr.map((x) => x.charge_date).filter(Boolean);
    const amounts = arr.map((x) => Number(x.amount_usd || 0)).filter((n) => Number.isFinite(n) && n > 0);
    const latest = arr.sort((a, b) => String(b.charge_date).localeCompare(String(a.charge_date)))[0];
    const current = providers.get(k) || {
      provider_key: k,
      display_name: latest?.display_name || k,
      amount_usd: latest?.amount_usd || null,
      source: "plaid_transactions_derived",
      metadata: {},
    };
    current.billing_cycle = current.billing_cycle || inferCycleFromDates(dates);
    current.last_charge_date = current.last_charge_date || latest?.charge_date;
    current.renewal_date = current.renewal_date || addCycle(current.last_charge_date, current.billing_cycle);
    current.price_increase_detected = detectPriceIncrease(amounts);
    providers.set(k, current);
  }

  for (const [k, v] of providersFromEmail.entries()) {
    if (!providers.has(k)) providers.set(k, v);
  }

  const latestUsageByProvider = new Map();
  for (const u of usageSignals) {
    const cur = latestUsageByProvider.get(u.provider_key);
    const ts = new Date(u.signal_date).getTime();
    if (!cur || ts > cur) latestUsageByProvider.set(u.provider_key, ts);
  }

  const subs = [];
  const now = Date.now();
  for (const s of providers.values()) {
    const key = s.provider_key;
    const usageTs = latestUsageByProvider.get(key) || 0;
    const unused = usageTs ? (now - usageTs) > (30 * 86400000) : true;
    const monthly = cycleToMonthlyCost(s.amount_usd, s.billing_cycle || "monthly");
    subs.push({
      provider_key: key,
      display_name: s.display_name,
      amount_usd: s.amount_usd,
      billing_cycle: s.billing_cycle || "monthly",
      renewal_date: s.renewal_date,
      last_charge_date: s.last_charge_date,
      monthly_cost_usd: Number(monthly.toFixed(2)),
      source: s.source || "derived",
      duplicate_group: null,
      unused_30d: unused,
      price_increase_detected: Boolean(s.price_increase_detected),
      notes: null,
      metadata: s.metadata || {},
    });
  }

  const deduped = dedupeByProvider(subs);
  const dupSet = detectDuplicates(deduped);
  for (const s of deduped) {
    const found = [...dupSet].find((x) => x.endsWith(`:${s.provider_key}`));
    if (found) s.duplicate_group = found.split(":")[0];
  }

  const alerts = [];
  for (const s of deduped) {
    if (!s.renewal_date) continue;
    const diff = Math.round((new Date(s.renewal_date) - new Date()) / 86400000);
    if (diff >= 0 && diff <= 3) {
      alerts.push({
        alert_type: "subscription_renewal_3d",
        provider_key: s.provider_key,
        due_date: s.renewal_date,
        payload: {
          display_name: s.display_name,
          amount_usd: s.amount_usd,
          billing_cycle: s.billing_cycle,
          renewal_date: s.renewal_date,
        },
      });
    }
  }

  await upsertSubscriptions(deduped, dryRun);
  await insertAlerts(alerts, dryRun);

  const monthlyTotal = Number(deduped.reduce((a, b) => a + Number(b.monthly_cost_usd || 0), 0).toFixed(2));
  const cut = buildCutRecommendations(deduped);

  const out = {
    generated_at: nowIso(),
    dry_run: dryRun,
    warnings,
    summary: {
      active_subscriptions: deduped.length,
      monthly_total_usd: monthlyTotal,
      renewal_alerts_3d: alerts.length,
      unused_30d_count: deduped.filter((x) => x.unused_30d).length,
      duplicate_count: deduped.filter((x) => x.duplicate_group).length,
      price_increase_count: deduped.filter((x) => x.price_increase_detected).length,
    },
    subscriptions: deduped,
    cut_recommendations: cut,
    alerts,
  };

  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-subscription-audit.json`);
  const latestPath = path.join(REPORT_DIR, "subscription-audit-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(out, null, 2));

  return { ...out, json_path: jsonPath, latest_path: latestPath };
}

async function runTaxPrepAutomation(opts = {}) {
  await ensureSchema();
  ensureDir(REPORT_DIR);

  const dryRun = Boolean(opts.dry_run);
  const year = Number(opts.year || new Date().getFullYear());
  const daysBack = Math.max(30, Math.min(730, Number(opts.days_back || 365)));
  const taxRoot = process.env.TAX_ROOT_DIR || TAX_ROOT_DEFAULT;
  const yearDir = path.join(taxRoot, String(year));
  const incomeDir = path.join(yearDir, "income");
  const receiptsDir = path.join(yearDir, "receipts");
  const summariesDir = path.join(yearDir, "summaries");

  ensureDir(incomeDir);
  ["business_software", "business_supplies", "business_travel", "medical", "charitable", "other"].forEach((c) => ensureDir(path.join(receiptsDir, c)));
  ensureDir(summariesDir);

  const warnings = [];

  const plaidTx = await fetchPlaidTransactions(daysBack);
  if (!plaidTx.ok) warnings.push(`plaid_transactions: ${plaidTx.error}`);

  const incomeEmails = await listGmailMessages("(1099 OR W-2 OR W2 OR 1098 OR \"tax document\" OR \"tax form\") newer_than:730d", 200);
  if (!incomeEmails.ok) warnings.push(`gmail_income_scan: ${incomeEmails.error}`);

  const receiptEmails = await listGmailMessages("(receipt OR invoice OR billed OR payment confirmation OR charge) newer_than:730d", 300);
  if (!receiptEmails.ok) warnings.push(`gmail_receipt_scan: ${receiptEmails.error}`);

  const expenseItems = [];
  if (plaidTx.ok) {
    for (const t of plaidTx.data.transactions || []) {
      const date = toDateISO(t.date);
      if (!date || Number(date.slice(0, 4)) !== year) continue;
      if (!(Number(t.amount) > 0)) continue;
      const vendor = t.merchant_name || t.name || "Unknown";
      const cat = classifyTaxCategory(`${vendor} ${(t.category || []).join(" ")}`);
      expenseItems.push({
        tax_year: year,
        txn_date: date,
        vendor,
        amount_usd: Number(t.amount || 0),
        category: cat.category,
        deductible: cat.deductible,
        source: "plaid_transactions",
        external_id: t.transaction_id || null,
        receipt_path: null,
        metadata: t,
      });
    }
  }

  const incomeDocs = [];
  if (incomeEmails.ok) {
    for (const m of incomeEmails.messages) {
      const date = toDateISO(m.internalDate || Date.now());
      if (!date || Number(date.slice(0, 4)) !== year) continue;
      const docType = detectDocType(`${m.subject} ${m.snippet}`);
      const fileName = `${date}-${m.id}-${docType}.json`;
      const savePath = path.join(incomeDir, fileName);
      const doc = {
        message_id: m.id,
        subject: m.subject,
        from: m.from,
        date,
        snippet: m.snippet,
        doc_type: docType,
      };
      if (!dryRun) fs.writeFileSync(savePath, JSON.stringify(doc, null, 2));
      incomeDocs.push({
        tax_year: year,
        doc_type: docType,
        subject: m.subject,
        doc_date: date,
        source: "gmail",
        external_id: m.id,
        storage_path: savePath,
        metadata: doc,
      });
    }
  }

  if (receiptEmails.ok) {
    for (const m of receiptEmails.messages) {
      const date = toDateISO(m.internalDate || Date.now());
      if (!date || Number(date.slice(0, 4)) !== year) continue;
      const parsed = classifyTaxCategory(`${m.subject} ${m.snippet} ${m.from}`);
      const fileName = `${date}-${m.id}.json`;
      const savePath = path.join(receiptsDir, parsed.category, fileName);
      const rec = {
        message_id: m.id,
        subject: m.subject,
        from: m.from,
        date,
        snippet: m.snippet,
        category: parsed.category,
      };
      if (!dryRun) fs.writeFileSync(savePath, JSON.stringify(rec, null, 2));

      expenseItems.push({
        tax_year: year,
        txn_date: date,
        vendor: m.from || "email_receipt",
        amount_usd: parseMoney(`${m.subject} ${m.snippet}`),
        category: parsed.category,
        deductible: parsed.deductible,
        source: "gmail_receipt",
        external_id: m.id,
        receipt_path: savePath,
        metadata: rec,
      });
    }
  }

  if (!dryRun) {
    for (const e of expenseItems) {
      await pg.query(
        `INSERT INTO tax_expense_items
          (tax_year, txn_date, vendor, amount_usd, category, deductible, source, external_id, receipt_path, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (source, external_id)
         DO UPDATE SET
           txn_date=EXCLUDED.txn_date,
           vendor=EXCLUDED.vendor,
           amount_usd=EXCLUDED.amount_usd,
           category=EXCLUDED.category,
           deductible=EXCLUDED.deductible,
           receipt_path=EXCLUDED.receipt_path,
           metadata=EXCLUDED.metadata,
           updated_at=NOW()`,
        [e.tax_year, e.txn_date, e.vendor, e.amount_usd, e.category, e.deductible, e.source, e.external_id, e.receipt_path, JSON.stringify(e.metadata || {})]
      );
    }

    for (const d of incomeDocs) {
      await pg.query(
        `INSERT INTO tax_income_documents
          (tax_year, doc_type, subject, doc_date, source, external_id, storage_path, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (source, external_id)
         DO UPDATE SET
           doc_type=EXCLUDED.doc_type,
           subject=EXCLUDED.subject,
           doc_date=EXCLUDED.doc_date,
           storage_path=EXCLUDED.storage_path,
           metadata=EXCLUDED.metadata`,
        [d.tax_year, d.doc_type, d.subject, d.doc_date, d.source, d.external_id, d.storage_path, JSON.stringify(d.metadata || {})]
      );
    }
  }

  const totalsByCategory = {};
  let deductibleTotal = 0;
  for (const e of expenseItems) {
    const amt = Number(e.amount_usd || 0);
    if (!Number.isFinite(amt)) continue;
    totalsByCategory[e.category] = Number((Number(totalsByCategory[e.category] || 0) + amt).toFixed(2));
    if (e.deductible) deductibleTotal += amt;
  }
  deductibleTotal = Number(deductibleTotal.toFixed(2));

  const docTypes = new Set(incomeDocs.map((d) => d.doc_type));
  const missing = [];
  if (!docTypes.has("1099") && !docTypes.has("W-2")) missing.push("No 1099 or W-2 detected in income folder");
  if ((expenseItems || []).length === 0) missing.push("No expense items detected for the selected tax year");

  const summary = {
    generated_at: nowIso(),
    tax_year: year,
    dry_run: dryRun,
    warnings,
    totals_by_category: totalsByCategory,
    deductible_total_usd: deductibleTotal,
    income_docs_count: incomeDocs.length,
    expense_items_count: expenseItems.length,
    missing_flags: missing,
    folder_structure: {
      root: yearDir,
      income: incomeDir,
      receipts: receiptsDir,
      summaries: summariesDir,
    },
  };

  const summaryJson = path.join(summariesDir, `tax-summary-${year}.json`);
  const summaryMd = path.join(summariesDir, `tax-summary-${year}.md`);
  const md = [
    `# Tax Summary ${year}`,
    "",
    `Generated: ${summary.generated_at}`,
    "",
    `- Deductible total: $${summary.deductible_total_usd}`,
    `- Income docs: ${summary.income_docs_count}`,
    `- Expense items: ${summary.expense_items_count}`,
    "",
    "## Totals by category",
    ...Object.entries(totalsByCategory).map(([k, v]) => `- ${k}: $${v}`),
    "",
    "## Missing flags",
    ...(missing.length ? missing.map((m) => `- ${m}`) : ["- none"]),
    "",
  ].join("\n");

  if (!dryRun) {
    fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2));
    fs.writeFileSync(summaryMd, md);
  }

  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportPath = path.join(REPORT_DIR, `${stamp}-tax-prep-automation.json`);
  const latestPath = path.join(REPORT_DIR, "tax-prep-automation-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  return { ...summary, report_path: reportPath, latest_path: latestPath };
}

module.exports = {
  ensureSchema,
  runSubscriptionAudit,
  runTaxPrepAutomation,
};

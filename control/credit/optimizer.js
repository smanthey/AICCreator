"use strict";

const pg = require("../../infra/postgres");

function roundMoney(n) {
  return Math.max(0, Math.round(Number(n || 0) * 100) / 100);
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDay(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 31) return null;
  return Math.trunc(n);
}

function nextDateForDay(day, leadDays = 7) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const candidate = new Date(y, m, Math.min(day, 28));
  if (candidate <= now) {
    return new Date(y, m + 1, Math.min(day, 28));
  }
  candidate.setDate(candidate.getDate() - leadDays);
  return candidate;
}

function dedupeAccounts(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = `${String(r.account_ref || "").trim().toLowerCase()}|${String(r.furnisher_name || "").trim().toLowerCase()}`;
    if (!key || key === "|") continue;
    const cur = map.get(key);
    const util = safeNum(r.balance) / Math.max(1, safeNum(r.credit_limit));
    if (!cur || util > cur._util) {
      map.set(key, { ...r, _util: util });
    }
  }
  return [...map.values()];
}

function computeTargets(accounts, perCardTarget = 0.09) {
  return accounts.map((a) => {
    const bal = roundMoney(a.balance);
    const lim = roundMoney(a.credit_limit);
    const utilNow = lim > 0 ? bal / lim : 0;
    const targetBal = roundMoney(lim * perCardTarget);
    const paydownNeeded = roundMoney(Math.max(0, bal - targetBal));
    const statementDay =
      parseDay(a.raw_data_json?.statement_day) ||
      parseDay(a.raw_data_json?.statementDay) ||
      parseDay(a.raw_data_json?.statement_date_day) ||
      null;
    const paymentBy = statementDay ? nextDateForDay(statementDay, 7).toISOString().slice(0, 10) : null;
    return {
      account_id: a.id,
      account_ref: a.account_ref,
      furnisher_name: a.furnisher_name,
      balance: bal,
      credit_limit: lim,
      utilization_now: utilNow,
      target_balance: targetBal,
      paydown_needed: paydownNeeded,
      statement_day: statementDay,
      payment_by: paymentBy,
      remarks: a.remarks || null,
    };
  });
}

function allocateBudgetGreedy(targets, monthlyBudget = 0) {
  const budget = roundMoney(monthlyBudget);
  if (!budget || budget <= 0) {
    return {
      monthly_budget: 0,
      allocated_total: 0,
      lines: targets.map((t) => ({
        ...t,
        recommended_payment: 0,
        projected_balance: t.balance,
        projected_utilization: t.utilization_now,
      })),
    };
  }

  const ranked = [...targets].sort((a, b) => {
    if (a.utilization_now !== b.utilization_now) return b.utilization_now - a.utilization_now;
    return b.paydown_needed - a.paydown_needed;
  });

  let remaining = budget;
  const lines = ranked.map((t) => {
    const pay = roundMoney(Math.min(remaining, t.paydown_needed));
    remaining = roundMoney(remaining - pay);
    const projectedBalance = roundMoney(Math.max(0, t.balance - pay));
    const projectedUtil = t.credit_limit > 0 ? projectedBalance / t.credit_limit : 0;
    return {
      ...t,
      recommended_payment: pay,
      projected_balance: projectedBalance,
      projected_utilization: projectedUtil,
    };
  });

  return {
    monthly_budget: budget,
    allocated_total: roundMoney(budget - remaining),
    lines,
  };
}

async function loadTradeLines(reportId) {
  const { rows } = await pg.query(
    `SELECT id, account_ref, furnisher_name, balance, credit_limit, remarks, raw_data_json
     FROM credit_items
     WHERE report_id = $1
       AND item_type = 'trade_line'
       AND credit_limit IS NOT NULL
       AND credit_limit > 0`,
    [reportId]
  );
  return dedupeAccounts(rows);
}

function summarize(lines) {
  const totals = lines.reduce(
    (a, l) => {
      a.balance += safeNum(l.balance);
      a.limit += safeNum(l.credit_limit);
      a.projected_balance += safeNum(l.projected_balance);
      a.paydown_needed += safeNum(l.paydown_needed);
      return a;
    },
    { balance: 0, limit: 0, projected_balance: 0, paydown_needed: 0 }
  );
  const overallNow = totals.limit > 0 ? totals.balance / totals.limit : 0;
  const overallProjected = totals.limit > 0 ? totals.projected_balance / totals.limit : 0;
  return {
    revolving_accounts: lines.length,
    total_balance: roundMoney(totals.balance),
    total_limit: roundMoney(totals.limit),
    overall_utilization_now: overallNow,
    overall_utilization_projected: overallProjected,
    paydown_needed_to_hit_per_card_target: roundMoney(totals.paydown_needed),
  };
}

async function buildUtilizationPlan(reportId, opts = {}) {
  const perCardTarget = Number(opts.perCardTarget || 0.09);
  const monthlyBudget = Number(opts.monthlyBudget || 0);
  const accounts = await loadTradeLines(reportId);
  const targets = computeTargets(accounts, perCardTarget);
  const allocation = allocateBudgetGreedy(targets, monthlyBudget);
  const summary = summarize(allocation.lines);
  return {
    per_card_target: perCardTarget,
    ...allocation,
    summary,
  };
}

module.exports = {
  buildUtilizationPlan,
};


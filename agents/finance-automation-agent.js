"use strict";

const { register } = require("./registry");
const { runSubscriptionAudit, runTaxPrepAutomation } = require("../control/finance-ops");

register("subscription_audit_run", async (payload = {}) => {
  const out = await runSubscriptionAudit(payload);
  return {
    ok: true,
    summary: out.summary,
    warnings: out.warnings || [],
    monthly_total_usd: out.summary?.monthly_total_usd || 0,
    subscriptions: out.summary?.active_subscriptions || 0,
    renewal_alerts_3d: out.summary?.renewal_alerts_3d || 0,
    json_path: out.json_path,
  };
});

register("tax_prep_automation_run", async (payload = {}) => {
  const out = await runTaxPrepAutomation(payload);
  return {
    ok: true,
    tax_year: out.tax_year,
    warnings: out.warnings || [],
    deductible_total_usd: out.deductible_total_usd || 0,
    income_docs_count: out.income_docs_count || 0,
    expense_items_count: out.expense_items_count || 0,
    missing_flags: out.missing_flags || [],
    report_path: out.report_path,
  };
});

# Monetization Strategy

**Canonical order of attack:** (1) Lead gen pushing Skyn Patch the most, (2) ClawPay unlimited via OpenClaw $1+ Stripe, (3) Complete SaaS repos closest to monetization after real-world testing.

---

## 1. Lead gen — push Skyn Patch the most

**Rationale:** Skyn Patch has the most inventory on hand — **100k+ wholesale USD**. Lead gen should prioritize Skyn Patch over other brands so we convert that inventory into revenue first.

**How it’s implemented:**
- **Send volume:** Skyn Patch gets way more daily sends than BWS (e.g. 50 vs 12 per cycle). See `config/leadgen-send-ratio.json`, `ecosystem.background.config.js` (claw-lead-autopilot-skynpatch vs claw-lead-autopilot-bws).
- **Lead quality:** Buyer-focused emails (wholesale@, buyer@, /wholesale pages first), buyer-like `contact_title` prioritized when sending. See `scripts/email-finder.js`, `scripts/enrich-leads-email.js`, send schedulers’ ORDER BY.
- **Runbook:** `docs/LEADGEN-RUNBOOK.md`.

**Operational rule:** When adding or tuning lead-gen flows, skew volume and quality toward Skyn Patch; keep BWS and others secondary until Skyn Patch inventory is moving.

---

## 2. ClawPay — unlimited as long as we find OpenClaw $1+ and Stripe

**Rationale:** ClawPay (bot-to-bot payment rail) is **unlimited** in potential — every OpenClaw user who asks for $1+ in a message is a conversion opportunity. The constraint is **discovery**: finding those communications and completing the Stripe flow.

**Strategy:**
- **Detect:** Find OpenClaw communication (WhatsApp, Telegram, Discord, etc.) where someone is **asking for $1+** (payment request, tip, purchase).
- **Route:** Send that intent through the ClawPay rail into **Stripe** (payment-router, checkout, webhooks).
- **Complete:** Ensure the bot-commerce and payment-router flow can create checkouts, confirm payments, and fulfill so that “ask for $1+” becomes real revenue.

**References:** `docs/FOREMAN-COORDINATION-AND-PAYCLAW.md` (ClawPay rail contract), `scripts/bot-commerce.js`, `scripts/payment-router.js`, `docs/TOP-PRIORITY-AREAS.md` (ClawPay tasks priority 9). When improving ClawPay, focus on **discovery of $1+ asks** and **Stripe completion**, not just maintenance.

---

## 3. Complete SaaS repos closest to monetization (after real-world testing)

**Rationale:** Not all repos are equal. Prioritize **repos closest to monetization** and harden them **after real-world testing** so we ship revenue-ready products, not just green builds.

**Order of completion:**
- Repos that already have Stripe, checkout, or payment flows (e.g. PayClaw, AutoPay UI, CaptureInbound, capture) and need webhook/auth/e2e hardening.
- Use **repo-completion-gap** and **builder pulse** (gap → repo_autofix / opencode_controller) to close gaps.
- **Gate:** Prefer real-world testing (launch e2e, QA human-grade, staging usage) before declaring “monetization-ready”; then complete the remaining gaps and ship.

**Config:** `config/top-priority-areas.json`, `config/repo-completion-master-list.json`. P0/P1 repos (CookiesPass, PayClaw, CaptureInbound, capture, infinitedata, autopay_ui, Inbound-cookies) are the ones closest to revenue; complete them in that order, with testing gates.

---

## Summary

| Pillar | Focus | Key lever |
|--------|--------|-----------|
| **1. Lead gen** | Skyn Patch first | Volume + buyer quality; 100k+ wholesale inventory |
| **2. ClawPay** | Unlimited upside | Find OpenClaw $1+ asks → Stripe completion |
| **3. SaaS completion** | Closest to revenue first | Gap closure + real-world testing gate |

**Cross-references:** `agent-state/handoffs/GOALS.md` (goal 5 Monetize), `STRATEGY.md` (Revenue is Real), `docs/TOP-PRIORITY-AREAS.md`, `docs/LEADGEN-RUNBOOK.md`, `docs/FOREMAN-COORDINATION-AND-PAYCLAW.md`.

---

## Runbooks (closer to monetization)

- **One-place readiness:** `npm run monetization:readiness` — writes `reports/monetization-readiness-latest.md` and `.json`. Shows ClawPay (PM2 + Stripe env), lead gen (Skyn Patch ratio), SaaS (P0/P1 gap status), blockers, next steps.
- **Close P0/P1 gaps:** Run gap analysis, then enqueue work:
  1. `node scripts/repo-completion-gap-one.js --repo CookiesPass` (or `--next` for round-robin).
  2. `npm run monetization:gap:enqueue` — enqueues `opencode_controller` (priority 9) for each P0/P1 repo that has `next_actions` in the rolling gap report. Use `--dry-run` to preview.

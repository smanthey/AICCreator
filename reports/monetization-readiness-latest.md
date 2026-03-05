# Monetization Readiness

Generated: 2026-03-05T03:16:39.341Z

## Blockers
- SaaS: Close P0/P1 gaps — run repo-completion-gap-one then enqueue gap-closure tasks (npm run monetization:gap:enqueue)

## Next steps
- ClawPay is configured (cron apps may show stopped between runs); focus on discovery volume and first conversion.
- Lead gen: Ensure claw-lead-autopilot-skynpatch and claw-lead-autopilot-bws are in PM2 (cron); check config/leadgen-send-ratio.json.
- Run: node scripts/repo-completion-gap-one.js --repo CookiesPass (or --next); then npm run monetization:gap:enqueue

## ClawPay
- Apps: {"claw-prompt-oracle":"online","claw-bot-commerce-api":"online","claw-bot-discovery":"stopped","claw-bot-outreach":"stopped"}
- Env set: {"STRIPE_SECRET_KEY":true,"STRIPE_WEBHOOK_SECRET":true,"COMMERCE_PUBLIC_URL":true}
- Ready: true

## Lead gen
- Skyn Patch send_max: 50, BWS: 12

## SaaS (P0/P1)
- CookiesPass: score=51 incomplete=5 — Add tenant resolver and organization_id guardrails; Remove placeholder/fake patterns
- payclaw: score=75 incomplete=0 — 
- CaptureInbound: score=81 incomplete=0 — 
- capture: score=85 incomplete=0 — Remove placeholder/fake patterns
- autopay_ui: score=83 incomplete=0 — 
# PayClaw research (swarm-maintained)

This file is the canonical place for PayClaw-specific research. The swarm keeps it updated via tasks with focus `payclaw` (e.g. `research_sync`, `research_signals`) or dedicated research runs. Creators and the update flow use it for accurate implementation guidance.

## Reference implementation: AutopayAgent (autopay_ui)

PayClaw is a version of the AutopayAgent system (repo **autopay_ui**). Copy as much as works: Stripe checkout/webhooks, Telnyx SMS, webhook signature verification, message scheduling. Omit auth and multi-tenant code; PayClaw is single-tenant / desktop with Stripe Connect–only onboarding. Capability factory reports list autopay_ui for: billing.stripe.checkout, billing.stripe.webhooks, comms.telnyx.sms, webhooks.signature_verify — use those areas as copy sources.

## Topics to maintain

- **Telnyx & 10DLC:** Number provisioning, brand/campaign registration, sample messages, STOP/HELP handling, rate limits, API usage.
- **Stripe Connect:** Per-merchant OAuth, platform fees, webhooks (payment_intent, account.updated), idempotency, testing with Connect.
- **Electron DMG / packaging:** electron-builder (mac + dmg), code signing (Apple Developer), notarization for distribution outside App Store, env/secure storage for Telnyx and Stripe keys, auto-update (e.g. electron-updater).

## How to refresh

- From mission control or goal-autopilot: run research tasks with payload e.g. `{ focus: "payclaw", topics: ["telnyx_10dlc", "stripe_connect", "electron_dmg_notarization"] }`.
- Or run `npm run research:sync` / `npm run research:signals` with PayClaw focus if supported by the script.

---

*Placeholder. Replace this section with concrete notes, links, and snippets as research runs complete.*

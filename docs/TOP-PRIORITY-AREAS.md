# Top-Priority Areas — Lead Gen, PayClaw, ClawPay, Roblox

**Goal:** These four areas are top priority. Their tasks use **priority 9** (vs default 3–5) so they dispatch first. Work **spreads across all devices** (NAS, i7-desktop, AI satellite) via the shared Redis queue — no single device bottleneck.

**Monetization strategy:** (1) **Lead gen** — push **Skyn Patch the most** (100k+ wholesale inventory). (2) **ClawPay** — unlimited; find OpenClaw $1+ asks, complete Stripe. (3) **SaaS completion** — repos closest to revenue first, after real-world testing. Full doc: `docs/MONETIZATION_STRATEGY.md`.

---

## The Four Areas

| Area | Mission / Flow | Tasks |
|------|----------------|-------|
| **Lead Gen** | lead:autopilot, lead:bws:send, content-publish | fetch_leads, send_email |
| **PayClaw** | payclaw_saas_builder, payclaw:dispatch:chunks | opencode_controller (payclaw repo) |
| **ClawPay** | bot_collection_autonomous, claw-prompt-oracle | WhatsApp/Telegram/Discord commerce |
| **Roblox** | roblox_game_growth | github_sync, site_audit, opencode_controller (RobloxGitSync) |

---

## Spreading Work Across Devices

1. **All devices use the same Redis.** Set `REDIS_HOST=192.168.1.164` on NAS, i7-desktop, and AI satellite. Ecosystem configs for i7 and ai-satellite include this.
2. **Workers on each device** consume from the same queues. When Roblox or PayClaw queues tasks, whichever device has an idle worker with matching tags picks them up.
3. **Priority 9** ensures top-priority tasks are dispatched before lower-priority ones (dispatcher orders by `priority DESC`).
4. **Idle devices** get top-priority work: when an AI worker is idle, device-utilization can spawn opencode_controller for RobloxGitSync or PayClaw.

---

## Config

- **config/top-priority-areas.json** — Canonical list and priority value.
- **scripts/roblox-game-growth-pulse.js** — Uses `TOP_PRIORITY = 9` for all Roblox tasks.
- **scripts/payclaw-dispatch-chunks.js** — Uses `priority = 9` for PayClaw chunks.
- **control/device-utilization.js** — AI idle strategies include opencode_controller for Roblox and PayClaw (priority 9).

---

## Lead Gen and ClawPay

- **Lead Gen:** Lead flows use `lead:autopilot`, `lead:bws:send`; fetch_leads/send_email are queued by content-publish and daily schedulers. When adding new lead-gen task creation, use `priority: 9`.
- **ClawPay:** Bot commerce runs always-on (claw-prompt-oracle); bot_collection_autonomous runs every 4h. ClawPay tasks (outreach, discovery) are created by those scripts. When those scripts queue tasks, they should use `priority: 9` — update as needed.

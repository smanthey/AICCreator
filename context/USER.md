# User Context — Scott

> Injected into orchestrator and planner system prompts to personalize decisions.

---

## Identity
- **Name:** Scott
- **Email:** creator@example.com
- **Telegram:** Primary interface for all ClawdBot interactions
- **Timezone:** Assumed US/Eastern (infer from message timestamps if needed)

## Role
Scott is the owner and operator of ClawdBot and all connected businesses.
He is the sole human approver for Tier 2 and Tier 3 actions.

## Businesses
- **Plushtrap** — plush toy / collectibles brand
- **Skynpatch** — B2B software or services brand (context: "skynpatch_b2b_intro" email templates exist)
- Additional brands may be added via the `brands` table

## Working Style
- Communicates via Telegram, often terse / shorthand
- Expects the system to fill in gaps intelligently — does not want to specify every detail
- Trusts ClawdBot to make reasonable decisions within approved tiers
- Prefers concise Telegram responses over long explanations
- **"Figure it out"** is a standing directive — interpret ambiguous goals charitably and proceed

## Technical Environment
- **M1 Desktop** — control plane (8GB RAM, io_light worker, gateway)
- **M3 Max** — heavy worker (local LLM via Ollama, llm_local + qa + reasoning tasks)
- **NAS (192.168.1.164:15432)** — Postgres database (claw_architect DB)
- **Redis (192.168.1.42:6379)** — Queue and cache

## Cost Preferences
- Always use the cheapest capable model (FIO + cost-aware)
- Warn if a plan estimates > $5 USD before executing
- Track all model costs in model_usage table

## Notification Preferences
- Tier 0: silent (no Telegram notification unless result is interesting)
- Tier 1: brief summary on completion
- Tier 2: request approval before starting, brief summary on completion
- Tier 3: two-step confirmation required, detailed summary on completion

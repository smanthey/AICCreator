# Goals

1. Build the ultimate company dashboard and data collector.
2. Turn dashboard insights into an action-item center.
3. Pull data from all selling channels.
4. Build and operate a master inventory source of truth.
5. **Monetize:** (1) Lead gen push Skyn Patch the most (100k+ wholesale inventory). (2) ClawPay unlimited — find OpenClaw $1+ asks, complete Stripe. (3) Complete SaaS repos closest to monetization after real-world testing. See `docs/MONETIZATION_STRATEGY.md`.
6. **Complete builds:** Close repo-completion gaps (auth, webhooks, e2e, security) and get repos to green.
7. **Builder loop:** Run the builder (agent-team builder + repo-completion-gap + autofix) to fix indexed repos; feed learnings back into InayanBuilderBot.

# Operating Rules
- Generate 5-10 useful tasks each morning.
- Prioritize work that reduces risk and increases shipping speed.
- Maintain a live Kanban board with To Do / In Progress / Done.
- Use the builder in the workforce: run gap analysis on indexed repos, queue repo_autofix/opencode_controller, then update Inayan builder git from real use (see docs/INAYAN-BUILDER-REAL-USE.md).

# Immediate Repo TODO Queue
- P0: CookiesPass + TempeCookiesPass mission pulse completion.
- P0: **InayanBuilderBot** — run builder pulse (gap + autofix), fix bugs from real use, push improvements to Inayan git.
- P1: PayClaw webhook/payment flow completion and DMG-ready hardening.
- P1: CaptureInbound tenant/number mismatch self-heal + diagnostics.
- P1: capture compile integrity + usage-report scheduled job E2E completion.
- P1: infinitedata symbol-index gap closure + data-persistence hardening.
- P2: Inbound-cookies webhook signature enforcement and release checks.
- P2: autopay_ui payment/webhook flow integrity pass.

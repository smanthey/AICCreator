# Pushing rules and compliance into the PayClaw repo

When rules or compliance change in claw-architect, the swarm can update the PayClaw repo in one of these ways:

1. **Re-run the launcher (recommended)**  
   `npm run payclaw:launch -- --no-scaffold`  
   Re-copies `docs/payclaw/COMPLIANCE.md`, `config/payclaw/risk-categories.json`, and `config/payclaw/message-templates.txt` into the PayClaw repo. Does not overwrite README or other scaffold. Use the dashboard action **Sync PayClaw Context** or goal-autopilot task **payclaw_launch**.

2. **Optional: payclaw_sync_rules task**  
   A dedicated task could copy `docs/payclaw/*` (and config) into the PayClaw repo and commit. Not implemented by default; launcher re-run is sufficient.

3. **Queue opencode_controller**  
   When the repo needs implementation changes (not just compliance copy), queue an `opencode_controller` task with objective: “Update PayClaw repo per latest rules and compliance in claw-architect; see docs/payclaw/.” The swarm does not write product code; it keeps the repo aligned with rules and research.

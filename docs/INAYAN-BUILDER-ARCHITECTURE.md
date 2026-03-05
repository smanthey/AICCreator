# Inayan Builder — Architect → Agent → Subagents

**Canonical data:** `config/inayan-builder-context.js`. Exports: `hierarchy`, `jobFunctions`, `handoff`, `dataFlow`, `references`. Use in code for handoff contracts, data flow, and extension points.

---

## Summary

- **Hierarchy:** Architect (mission control) → Builder Agent (coordinator, owns SHIP_LOG) → subagents: Gap Pulse Runner (`scripts/builder-gap-pulse.js`), Research Agenda Runner (`scripts/builder-research-agenda.js`), repo_autofix, opencode_controller (workers).
- **Job functions:** See `jobFunctions` in context module (role, whatItDoes, triggeredBy, outputHandoff).
- **Handoff:** Builder → gap pulse via CLI flags; gap pulse → workers via payload (repo, source, gap_context, builder_policy); workers → site_fix_plan, site_audit, etc. Policy string: `BUILDER_COMPLETION_POLICY` in `scripts/builder-gap-pulse.js`.
- **Data flow:** See `dataFlow` array in context module (architect/trigger → builder run → brief:weekly + builder:gap:pulse → gap analysis → queue tasks → workers → agent-team-cycle appends SHIP_LOG).
- **Extend:** Add task type in task-routing + payload schema; queue from Gap Pulse or Builder with same gap_context/builder_policy. Planner TASK_CATALOG already includes builder_gap_pulse, repo_autofix, opencode_controller, site_fix_plan, site_audit.

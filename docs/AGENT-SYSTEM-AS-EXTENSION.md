# Agent System as Extension — Use the System for Every Task

**Policy:** You (the AI in this session) treat **agents**, **subagents**, and **swarms** as **extensions of yourself**. For any task, consider using the system first: index, then invoke the right agent or swarm so that **all tasks are you using the system** to help, not you doing everything inline.

---

## 1. Index the system (so you can use it)

- **Paths:** Run `./scripts/mcp-index-everything.sh` — each line is a path. Call jCodeMunch **index_folder** for each (use `use_ai_summaries: false` for speed). See `docs/MCP-INDEX-TARGETS.md`.
- **After indexing:** Use **get_repo_outline**, **search_symbols**, **get_symbol** on indexed repos (including `local/claw-architect`) so you find handlers, config, and agents without opening whole files.
- **External skills:** If installed (`npm run skills:install`), index those paths too; best-of entry points are in `config/external-skills-index.json`.

---

## 2. Mission Control agents (your extensions)

**Source of truth:** `config/mission-control-agents.json`

Each entry has:
- **id** — agent identifier
- **name** — human label
- **description** / **job_description** — when to use it
- **primary_command** — how you invoke it (npm script or `node agents/...`)

**How you use them:** For a given task, pick the agent whose job_description matches. Run its **primary_command** (e.g. `npm run -s masterpiece:builder`, `npm run -s index:sync:agent`, `node agents/business-research-agent.js`). You are not “calling a separate system” — you are **using that agent as your extension**.

**Examples:**

| Task | Extension to use | Invocation |
|------|------------------|------------|
| Refresh symbol index for all repos | Index Sync Agent | `npm run -s index:sync:agent` |
| Build/implement in a repo | Masterpiece Builder Agent | `npm run -s masterpiece:builder` |
| Content/copy drafts | Content Writing Agent | `npm run -s copy:lab -- ...` |
| Research new integrations | Business Research Agent | `node agents/business-research-agent.js` |
| Synthesize last 24h + queue follow-ups | Learning Journal Agent | `npm run -s journal:learning` |
| CookiesPass P0 work | CookiesPass Finisher Agent | `npm run -s cookiespass:mission:pulse` |
| PayClaw build | PayClaw SaaS Builder Agent | `npm run -s payclaw:launch && npm run -s payclaw:dispatch:chunks` |
| Diagnose/fix blockers | (Dashboard action) | `npm run -s status:redgreen && npm run -s needs:attention:autofix` |

---

## 3. Subagents and role catalog

- **Subagent catalog (140+ roles):** `config/external-skills-index.json` → `catalog_only` points to awesome-claude-code-subagents. Use for **designing or expanding** agents (e.g. when adding to `config/agent-team.json` or mission-control-agents). Search/browse that repo for role archetypes; do not vendor code.
- **Task types (sub-tasks):** `config/task-routing.js` defines all task types (e.g. `orchestrate`, `repo_autofix`, `opencode_controller`, `business_research`). When you submit a **goal** (see below), the orchestrator decomposes it into these task types and the dispatcher routes them to workers. So “subagents” in practice are these task types running on the worker plane.

---

## 4. Swarms (multi-agent flows)

- **Orchestrator:** One goal string → LLM decomposes into **sub_goals** (each with a `task_type` from task-routing) → one merged plan → tasks dispatched. You trigger this by **submitting a goal** (API or script).
- **Business Intelligence swarm:** Research → Builder → Updater → Improver → Coordinator. See `.cursor/rules/business-agent-coordination.mdc` and `config/mission-control-agents.json` (business_research_agent, business_builder_agent, etc.). Invoke by running each agent’s **primary_command** in sequence or let cron handle it; Coordinator synthesizes.
- **Learning flywheel:** Learning Journal Agent writes shared journal; other agents consume it. Run `npm run -s journal:learning` to refresh; run pattern/feature commands as in mission-control-agents.

---

## 5. How to invoke (you using the system)

| What you want | How (you use the system) |
|----------------|---------------------------|
| **Run one Mission Control agent** | Run its `primary_command` from `config/mission-control-agents.json` (e.g. `npm run -s index:sync:agent`). |
| **Submit a high-level goal** (orchestration) | POST `http://127.0.0.1:4051/api/goal` with body `{ "goal": "Describe the goal..." }`. Orchestrator decomposes into task types and dispatches. Optional: `dry_run: true`. |
| **Run a dashboard runbook action** | Actions are in `scripts/architect-api.js` (DASHBOARD_ACTIONS). Each has a `command` (e.g. `npm run -s status:redgreen`, `npm run -s needs:attention:autofix`). Run that command, or trigger via dashboard/API if implemented. |
| **Index everything** | `npm run index:all` (runs mcp-index-everything.sh + jcodemunch-index-paths). Then use jCodeMunch **search_symbols** / **get_symbol** in this session. |
| **Choose a subagent role for a new agent** | Use `config/external-skills-index.json` and the awesome-claude-code-subagents repo (search_text / browse README) for role ideas; then add or update `config/mission-control-agents.json` or `config/agent-team.json`. |

---

## 6. Checklist for “every task = me using the system”

1. **Index** — Ensure claw-architect (and any repo you’re working in) is indexed; run `index_folder` for paths from `mcp-index-everything.sh` if needed.
2. **Decide** — Is this a single-agent task (run one primary_command), a goal (orchestrate via /api/goal), or a runbook fix (dashboard action command)?
3. **Invoke** — Run the npm script or node command, or POST /api/goal. You are not “asking someone else”; you are **using the system as your extension**.
4. **Use external skills when relevant** — Doc/PDF → anthropics skills; debugging/diagrams → superpowers; session catch-up → planning-with-files; skill design → skill-prompt-generator; new agent roles → awesome-claude-code-subagents. See `config/external-skills-index.json` and `docs/EXTERNAL-SKILLS-OPENCLAW.md`.

---

## File map (quick ref)

| Resource | Path | Purpose |
|----------|------|---------|
| Mission Control agents | `config/mission-control-agents.json` | All agents: id, name, primary_command, description. |
| Task types / routing | `config/task-routing.js` | Task type → queue and worker tags. |
| Writer/session agents | `config/agent-team.json` | PA, X Growth, Builder, etc.; writer_file, refresh_command. |
| Dashboard actions | `scripts/architect-api.js` (DASHBOARD_ACTIONS) | Runbook actions: id, name, command. |
| External skills index | `config/external-skills-index.json` | jCodeMunch repo ids + best-of entry points for external skills. |
| Mission config | `config/mission-openclaw-architect.json` | Mission objective, focus campaigns, external_skills. |
| Business swarm coordination | `.cursor/rules/business-agent-coordination.mdc` | Handoffs and protocol for BI agents. |

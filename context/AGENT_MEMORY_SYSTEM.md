# Agent Memory + Continuous Improvement System

## Why this design

The system combines deterministic execution guardrails (queues, policies, schema checks) with file-based agent memory that is read and updated every run.

This follows current best-practice guidance:
- Keep evaluation and regression testing continuous and integrated with deployment pipelines.
- Use memory artifacts as explicit state, not hidden prompt residue.
- Preserve strict runtime controls so memory does not bypass policy.

## Runtime flow

1. **Prelude load**
- Agent loads `agent-state/` files in deterministic order:
  - `agents/<agent>/SOUL.md`
  - `agent-state/USER.md`
  - `agents/<agent>/AGENTS.md`
  - `agents/<agent>/MEMORY.md`
  - `agents/<agent>/memory/<today>.md`
  - `agents/<agent>/memory/<yesterday>.md`
  - `shared-context/FEEDBACK-LOG.md`
  - required handoffs (daily intel/assignments)

2. **Execution**
- Agent runs normal logic with existing policy + schema + queue controls.

3. **Writeback**
- Agent appends concise operational learning to daily log.

4. **Feedback promotion**
- Human/automation appends corrections to `FEEDBACK-LOG.md` and promotes stable rules into `MEMORY.md`.

5. **Maintenance + audit**
- Daily maintenance archives stale logs and dedupes memory.
- Audit checks file completeness and integration wiring.

## Commands

- `npm run agent:state:init`
- `npm run agent:feedback:add -- --agent planner --text "No emojis in user-facing output"`
- `npm run agent:memory:maintain`
- `npm run agent:memory:audit`
- `npm run qa:human:blocking`

## PM2 scheduled jobs

- `claw-qa-human-blocking` every 4 hours
- `claw-agent-memory-maintenance` daily at 02:20

## Sources used for implementation decisions

- OpenAI eval-driven development cookbook and Evals API docs.
- Anthropic guidance on agent reliability and context engineering.
- Google NotebookLM official docs (product capabilities and source-backed synthesis behavior).
- LangGraph memory + reflection agent patterns.


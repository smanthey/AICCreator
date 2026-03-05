# Tasks Kanban Runbook

## Purpose
Provide a simple file-backed task board with agent-safe workflow controls.

## Storage Contract
- Board state: `~/notes/tasks/tasks.json`
- Per-task run logs: `~/notes/tasks/runs/<task_id>/updates.md`

## Lifecycle
1. Create task in `To Do`.
2. Move to `In Progress` (auto-creates run folder).
3. Agents append updates as work progresses.
4. Use `mention` requests for cross-agent handoffs.
5. Only owner marks `Done`.

## Operational Guardrails
- Owner lock on `Done` transition prevents accidental closure by agents.
- Updates are append-only markdown logs for auditability.
- Requests stay open in task state until handled manually.

## Troubleshooting
- If board missing: run `npm run tasks:kanban -- init`.
- If updates missing: ensure task was moved to `In Progress` once.
- If cannot mark done: verify `--by` matches `TASKS_OWNER`.


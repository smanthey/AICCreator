# tasks.json Kanban Workflow

State file:
- `~/notes/tasks/tasks.json`

Run folders:
- `~/notes/tasks/runs/<task_id>/`

Rules:
- Moving a task to `In Progress` creates `runs/<task_id>/`.
- Agent updates append to `runs/<task_id>/updates.md`.
- Only owner can move a task to `Done` (`TASKS_OWNER`, default `<USER>`).
- `@mention` writes a request entry for another agent to pick up.

## Command

```bash
cd $HOME/claw-architect
npm run tasks:kanban -- init
npm run tasks:kanban -- add --title "Example task" --description "..." --priority 3 --by researcher
npm run tasks:kanban -- move --id <task_id> --to "In Progress" --by coder
npm run tasks:kanban -- update --id <task_id> --text "Implemented parser fix" --by coder
npm run tasks:kanban -- mention --id <task_id> --to reviewer --text "Please review stage 2 output" --by coder
npm run tasks:kanban -- move --id <task_id> --to Done --by <USER>
```

## Notes
- Use `npm run tasks:kanban -- list` to see grouped board state.
- Non-owner `Done` transitions are rejected.


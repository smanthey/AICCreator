# Dev Pipeline Runbook

## Purpose
Run a gated, staged dev workflow as a queued task:
- Research -> Implement -> Review -> Test -> Security

## Execution
1. Queue a task with `dev:pipeline:queue`.
2. Worker executes `dev_pipeline_run`.
3. Stage artifacts and final output are written under `~/notes/dev/pipelines/[task_slug]/`.

## Safety Defaults
- Default mode is `dry_run=true`.
- Use `--live` only when you want real branch setup and command execution.
- No destructive actions are part of this pipeline.

## Output Contract
- `stage_1_research.md`
- `stage_2_implement.md`
- `stage_3_review.md`
- `stage_4_test.md`
- `stage_5_security.md`
- `final_output.md`

## Operational Checks
- Confirm task creation in `tasks` table with type `dev_pipeline_run`.
- Confirm worker consumes queue `claw_tasks_io_heavy`.
- Confirm stage files exist and `final_output.md` includes:
  - `pr_branch`
  - `change summary`
  - `test evidence`
  - `risk notes`


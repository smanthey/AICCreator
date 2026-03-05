# Dev Pipeline Task Chain

Queue-backed subagent pipeline for software delivery:

1. `research`
2. `implement`
3. `review`
4. `test`
5. `security audit`

Each stage writes markdown to:
- `~/notes/dev/pipelines/[task_slug]/stage_[n]_<name>.md`

Final output writes to:
- `~/notes/dev/pipelines/[task_slug]/final_output.md`

Includes:
- PR branch target
- change summary
- test evidence
- risk notes

## Queue Command

```bash
npm run dev:pipeline:queue -- \
  --task "Implement X with Y constraints" \
  --task-slug x-y \
  --repo-path $HOME/claw-architect
```

By default this runs in safe mode (`dry_run=true`).
Use `--live` to execute branch setup and command stages.

## Optional Overrides

- `--base-branch main`
- `--branch-name codex/dev-pipeline-...`
- `--test-command "npm run -s qa:fast"`
- `--security-command "npm run -s security:sweep -- --dep-fail-on high"`


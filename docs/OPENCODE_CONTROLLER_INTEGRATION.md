# OpenClaw + OpenCode Integration

This integration uses OpenClaw as planner/router and OpenCode-style execution lanes for repo changes.

## Flow

1. `opencode_controller` builds a bounded plan for the coding objective.
2. Implementation tasks are queued:
   - `site_fix_plan`
   - `repo_autofix`
3. Review tasks are queued:
   - `site_audit`
   - `github_repo_audit`
   - `github_observability_scan`
4. If quality gate is not met, controller can iterate up to `max_iterations`.

## Queue a coding task

```bash
npm run opencode:controller:queue -- --repo quantfusion --objective "Fix auth and schema flow" --max-iterations 2 --quality-target 90
```

## Git repo system integration

`git:sites:subagent:pulse` now queues `opencode_controller` for selected repos. This allows the existing repo pulse system to push coding requests through plan -> implement -> review loops automatically.

## Safety

- Uses idempotency keys to prevent duplicate active runs.
- Uses bounded iterations (`max_iterations`) by default.
- No direct deploy action in this lane.

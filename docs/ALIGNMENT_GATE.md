# Alignment Gate (Fast)

Use before significant builds.

## Required upfront statement
1. Success criteria
2. Constraints (safety, time, scope)
3. Failure modes
4. Approach (tasks + order)

## Non-blocking default
If owner/user does not respond in time:
- proceed in `dry-run`
- enforce `read-only`
- disable destructive actions

## CLI
```bash
npm run alignment:gate -- --summary "<change summary>" --project claw-architect
```

Optional when alignment is explicitly confirmed:
```bash
npm run alignment:gate -- --summary "<change summary>" --project claw-architect --owner-responded
```

## Intent
Fast alignment without stalling execution. Defaults keep progress safe.

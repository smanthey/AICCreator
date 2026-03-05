# 6am Task Pull

Automates a safe morning task pull and completion run.

## Output

- `~/notes/daily/[YYYY-MM-DD]_done-while-sleeping.md`

## Command

```bash
npm run todo:6am:pull
```

Dry-run mode:

```bash
npm run todo:6am:pull -- --dry-run
```

## Sources

- Todoist (default when token is available)
- Things export JSON (read-only fallback)

## Required env (Todoist)

- `TODOIST_API_TOKEN`

## Optional env (Things)

- `THINGS_EXPORT_JSON=/absolute/path/to/things-export.json`

Notes:
- Things path is read-only in this workflow unless you add a write-capable integration.
- Tasks that look risky/unclear are not completed. They are listed under proposal-only.

## Safety defaults

- Completes only heuristic-safe tasks.
- Blocks destructive or high-risk wording (`delete`, `deploy`, `production`, `pay`, etc.).
- Tasks needing confirmation are drafted as proposals only.

## PM2 schedule

Configured in `ecosystem.background.config.js`:

- app: `claw-todo-6am-pull`
- schedule: `0 6 * * *` (6:00 AM local)

Apply:

```bash
pm2 reload ecosystem.background.config.js --update-env
pm2 save
```


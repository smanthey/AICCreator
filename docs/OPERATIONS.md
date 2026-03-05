# Operations Runbook

## Daily Routine

1. Refresh research and brief:
```bash
npm run content-creator:pipeline
```

2. Generate campaign variants:
```bash
npm run aicc:campaign
```

3. Schedule or adjust publish queue:
```bash
npm run aicc:autopublish:schedule -- --video /absolute/path/to/final.mp4
```

4. Execute scheduled posts:
```bash
npm run aicc:autopublish:run
```

5. Re-score with latest platform metrics:
```bash
npm run aicc:ab:score
```

## Dry Runs

- Publish dry-run:
```bash
node scripts/aicc-autopublish.js run-due --dry-run
```

## Failure Handling

- Check `reports/aicc-publish-results-latest.json`
- Re-run failed entries after credential or asset fixes

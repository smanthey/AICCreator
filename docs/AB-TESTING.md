# A/B Testing Loop

## Purpose

Rank generated variants and auto-promote the winner.

## Input

- Campaign: `reports/aicc-campaign-latest.json`
- Metrics: `reports/aicc-metrics-latest.json`

Metrics per variant can include:
- `retention_30s_pct`
- `ctr_pct`
- `avg_watch_sec`
- `impressions`
- `clicks`

## Run

```bash
node scripts/aicc-ab-loop.js \
  --campaign reports/aicc-campaign-latest.json \
  --metrics reports/aicc-metrics-latest.json
```

## Output

- `reports/aicc-ab-results-latest.json`
- `reports/aicc-promoted-variant-latest.json`

## Scoring Model

Current default weighted score:
- retention: 0.5
- ctr: 0.3
- average watch time: 0.2

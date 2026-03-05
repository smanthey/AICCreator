# SaaS Pain Opportunity Pipeline (Reddit + X)

This pipeline mines user pain-point language weekly and produces a product opportunity report.

## Goal

Find unmet SaaS demand signals such as:

- complaints and frustrations
- "I wish there was..."
- "why doesn't X do Y"
- repetitive manual business tasks that should be automated

Focus audience:

- small businesses
- freelancers
- content creators

## Script

- `scripts/saas-pain-opportunity-report.js`

## Run manually

```bash
cd $HOME/claw-architect
npm run saas:pain:report
```

Optional tuning:

```bash
npm run saas:pain:report -- --limit 200 --reddit-limit 50 --x-limit 50 --top 30
```

Fallback + diagnostics tuning:

```bash
npm run saas:pain:report -- --web-max-requests 12 --reddit-max-requests 50 --x-max-queries 10
```

## Outputs

Saved in `scripts/reports/`:

- `*-saas-pain-opportunity-report.json`
- `*-saas-pain-opportunity-report.md`
- `saas-pain-opportunity-report-latest.json`
- `saas-pain-opportunity-report-latest.md`

Each pain point includes:

1. problem summary
2. frequency (mention count)
3. evidence links
4. suggested product angles

## Data sources

### Reddit

Searches selected subreddits with weekly top posts for pain-language queries.
Collection order:

- Reddit OAuth API (`REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET`)
- Reddit public JSON fallback
- Reddit RSS fallback

### X

Preferred:

- X API v2 recent search when `X_BEARER_TOKEN` (or `TWITTER_BEARER_TOKEN`) is set

Fallback:

- Nitter RSS search instances (best-effort)

### Web fallback (when social sources are weak)

- Hacker News Algolia search API for additional pain/problem evidence
- Enabled automatically when Reddit + X records are below threshold

## Schedule

PM2 app:

- `claw-saas-pain-opportunity-report`
- schedule: weekly Monday 5:00 PM local time (`cron_restart: "0 17 * * 1"`)

Reload PM2 to apply:

```bash
cd $HOME/claw-architect
npm run pm2:background:reload
```

## Notes

- Frequency is relative to collected sample volume each run.
- If X API and Nitter are both unavailable, report still generates from Reddit.
- Results are integrated into `/api/progress` as `history.saas_pain_pipeline`.
- Report now includes source diagnostics (request method + hit counts) for self-healing troubleshooting.

## External references used

- X API recent search: https://developer.x.com/en/docs/x-api/search-overview
- X API endpoint/changelog notes: https://docs.x.com/x-api/posts/recent-search
- Reddit API auth (OAuth): https://www.reddit.com/dev/api/
- Reddit OAuth wiki mirror: https://github.com/reddit-archive/reddit/wiki/oauth2
- HN Algolia API: https://hn.algolia.com/api

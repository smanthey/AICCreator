# AI Marketplace Services OS

Package your capabilities as productized services and run intake/triage in one system.

## Service products

1. Research Reports (`$50-$200`)
2. Content Writing Packages (`$100-$500`)
3. Automation Builds (`$200-$2,000`)
4. Data Analysis (`$50-$300`)

## Commands

```bash
cd $HOME/claw-architect

npm run market:services:catalog
npm run market:services:listings
npm run market:jobs:dashboard
```

Add an incoming job (manual/API bridge):

```bash
npm run market:jobs:add -- \
  --marketplace 47jobs \
  --external-id 47jobs-001 \
  --title "Need AI automation for lead routing" \
  --description "Need webhook + CRM automation with QA" \
  --budget-min 300 \
  --budget-max 1200 \
  --contact-name "Client A" \
  --contact-email "client@example.com"
```

Triage new jobs into best-fit offers:

```bash
npm run market:jobs:triage -- --limit 25
```

## Outputs

Reports are written to `scripts/reports/`:

- `marketplace-service-catalog-latest.json/.md`
- `marketplace-service-listings-latest.json/.md`
- `marketplace-job-triage-latest.json/.md`

## Operational workflow

1. Run `catalog` to keep offers synced.
2. Run `listings` and post copy on target marketplaces.
3. Ingest incoming jobs with `jobs:add`.
4. Run `jobs:triage` to auto-match + propose pricing.
5. You handle relationships/closing, system handles delivery intake/ops.

## Target marketplaces

- 47jobs
- Upwork
- Contra
- Fiverr Pro
- Toptal Projects

## Notes

- Triage is deterministic keyword matching + budget/urgency scoring.
- You can wire a marketplace webhook/API feeder to call `jobs:add`.
- Use existing `agency:crm` commands to track won deals and retainers.

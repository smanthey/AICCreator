# ClawHub Skill Factory

Build and sell ClawHub skills from real market pain signals.

## What it does

1. Mines latest research outputs (`saas-pain-opportunity-report` + `reddit-digest`).
2. Identifies missing high-demand skill opportunities.
3. Scaffolds production-ready skill packs in `agents/skills/<skill-id>/`.
4. Runs quality checks with edge-case validation.
5. Tracks sales and feedback in Postgres for iteration.

## Commands

Run from:

```bash
cd $HOME/claw-architect
```

### 1) Find marketplace gaps

```bash
npm run clawhub:skills:gaps -- --top 10
```

### 2) Build first sellable batch (5 by default)

```bash
npm run clawhub:skills:build -- --top 5 --apply
```

### 3) Test quality and edge-case coverage

```bash
npm run clawhub:skills:test
```

### 4) Log sales + feedback and view metrics

```bash
npm run clawhub:skills:sync
npm run clawhub:skills:sale -- --skill clawhub-example-skill --name "Example Skill" --price 29 --qty 1
npm run clawhub:skills:feedback -- --skill clawhub-example-skill --rating 5 --sentiment positive --notes "Great ROI in first week"
npm run clawhub:skills:sales:report
```

## Generated skill pack files

- `SKILL.md` - core deliverable and workflow
- `README.md` - quick user documentation
- `LISTING.md` - sales copy and use cases
- `TEST_CASES.md` - edge-case and quality tests
- `pricing.json` - pricing model (`$10-$50` target)
- `skill.json` + `index.js` - runtime metadata and stub implementation

## Output reports

All reports are written to `scripts/reports/` with timestamped and `*-latest` files:

- `clawhub-skill-gaps-latest.json/.md`
- `clawhub-skill-build-latest.json/.md`
- `clawhub-skill-test-latest.json/.md`
- `clawhub-skill-sales-latest.json/.md`

## Pricing baseline

- Frequency >= 5: `$49` subscription candidate
- Frequency >= 3: `$39` one-time
- Frequency >= 2: `$29` one-time
- Otherwise: `$19` one-time

Tune after first 10 sales + feedback loops.

## Sales iteration loop

1. Publish top 3 skills first.
2. Collect at least 10 feedback entries.
3. Improve weak test cases and listings.
4. Reprice based on conversion and ratings.
5. Bundle related skills for higher AOV.

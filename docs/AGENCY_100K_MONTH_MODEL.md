# $100k/mo OpenClaw Agency Model (Execution Version)

This is the operator model for scaling to 20-50 retainer clients over 6-12 months.

## Revenue Structure

1. Lead gen engine
- Educational content + targeted outbound
- CTA: paid automation audit + discovery call

2. Onboarding package ($2,000-$5,000)
- Workflow setup
- Team training
- Handoff docs

3. Retainer ($500-$2,000/mo)
- Monitoring + fixes
- Monthly optimization
- Reporting + expansion roadmap

4. Upsells
- Custom skills
- API integrations
- Multi-brand expansion

## Unit Economics (default plan)

- Avg setup: $3,500
- Avg retainer: $1,250/mo
- New setups per month: 6
- Target monthly: $100,000

The planner command computes exact lead/proposal/close targets based on your assumptions.

## Commands

Run model:
```bash
npm run agency:plan
```

Track CRM pipeline:
```bash
npm run agency:crm -- account:add --name "Acme Health" --segment health_brand --source outbound
npm run agency:crm -- deal:add --account "Acme Health" --stage qualified --setup 3500 --retainer 1250
npm run agency:crm -- deal:advance --deal <deal_uuid> --stage proposal_sent --next-action "follow up Thu"
npm run agency:crm -- dashboard
```

Create case study:
```bash
npm run agency:crm -- case:add --account "Acme Health" --title "Acme onboarding win" --baseline "Manual ops" --outcome "8h/week saved"
```

Create sellable audit pack:
```bash
npm run agency:audit:pack -- --repo usipeorg
```

Generate proposal:
```bash
npm run agency:proposal -- --account "Acme Health"
```

## Pipeline Rules

- Every lead must have a stage and next action.
- Every closed-won account should have a case study draft within 7 days.
- Every case study needs measurable before/after metrics.
- Every proposal should include setup + retainer + one upsell path.

## Suggested Weekly Cadence

- Mon-Fri: outbound + follow-ups
- Tue/Thu: discovery calls
- Wed/Fri: delivery audits + proposal sends
- Weekly: publish at least 1 case study update
- Monthly: raise pricing for new clients if close rate remains above target

# Finance Automation (Plaid + Gmail + Tax Prep)

## What it does

- `subscription_audit_run`
  - Pulls recurring and transaction data from Plaid.
  - Scans Gmail for subscription receipts/renewals.
  - Builds normalized active subscription list with:
    - provider, amount, billing cycle, estimated renewal date
    - duplicate service groups
    - price increase flags
    - "unused 30+ days" flags (from usage/billing signals)
  - Creates 3-day renewal alerts.
  - Writes report: `scripts/reports/subscription-audit-latest.json`

- `tax_prep_automation_run`
  - Pulls expense transactions and categorizes potential deductions.
  - Scans Gmail for 1099/W-2/tax-document signals.
  - Creates folder structure under `taxes/<YEAR>/`:
    - `income/`
    - `receipts/<category>/`
    - `summaries/`
  - Writes summary reports and missing-doc flags.

## Environment

Required for Plaid pulls:

- `PLAID_ENV` (`sandbox|development|production`)
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ACCESS_TOKEN`

Optional:

- `TAX_ROOT_DIR` (default: `./taxes`)

Gmail scans use existing OAuth env already used by the credit pipeline.

## Run manually

```bash
npm run finance:subscription:audit -- --days-back 180 --max-email-scan 160
npm run finance:tax:prep -- --year 2026 --days-back 365
```

Dry run:

```bash
npm run finance:subscription:audit -- --dry-run
npm run finance:tax:prep -- --year 2026 --dry-run
```

## Queue both jobs

```bash
npm run finance:automation:queue -- --days-back 180 --year 2026
```

Dry-run queue payloads:

```bash
npm run finance:automation:queue -- --dry-run
```

## DB objects

Created by migration `071_finance_automation_os.sql`:

- `finance_subscriptions`
- `finance_subscription_charges`
- `finance_usage_signals`
- `finance_alerts`
- `tax_expense_items`
- `tax_income_documents`

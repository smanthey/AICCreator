# Senior Dev Gap-Closure Runbook

## Objective
Close blockers fast while keeping queues stable and monetization work in front.

## Execution Order (repeat loop)
1. `npm run -s audit:deep`
2. `npm run -s qa:fast`
3. `npm run -s e2e:launch:matrix`
4. `npm run -s status:redgreen`
5. `npm run -s capability:factory:pulse`
6. `npm run -s market:services:catalog && npm run -s market:services:listings && npm run -s market:jobs:dashboard`
7. `npm run -s agency:plan -- --target-monthly 100000 --avg-setup 3500 --avg-retainer 1250 --new-setups-per-month 8`
8. `npm run -s agency:audit:pack -- --repo usipeorg`

## Queue Stabilization
- Reconcile dead letters:
  - `npm run -s tasks:reconcile-deadletters`
- Verify runtime:
  - `npm run -s audit:runtime`
- If strict check needed:
  - `npm run -s audit:runtime -- --strict`

## Success Criteria
- `status:redgreen` is GREEN.
- `launch_e2e.blocking_failures = 0`.
- `qa:fast` all steps pass.
- Queue trend stable (no burst in recent dead letters).
- Fresh monetization artifacts created in `scripts/reports/`.

## Artifact Checklist
- Launch matrix report JSON path
- QA report JSON path
- Capability factory report JSON/MD path
- Marketplace listings JSON/MD path
- Agency plan JSON path
- Sellable audit pack JSON/MD path

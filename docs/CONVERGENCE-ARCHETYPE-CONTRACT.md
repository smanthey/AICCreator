# Archetype capability packs + completion contract + convergence runner

Repos are driven to a **completion contract** by **archetype**: each repo declares an archetype (e.g. `content_kb`, `saas_starter`, `payments`). The **convergence runner** runs gap analysis, evaluates the contract (required sections complete, no issues, no next_actions), and queues builder work for repos that don’t yet satisfy it.

## Pieces

1. **Archetype capability packs** (`config/archetype-capability-packs.json`)  
   Defines archetypes and their `required_sections`. Contract = all required sections complete + `issues.length === 0` + `next_actions.length === 0`.

2. **Completion contract** (`config/completion-contract.js`)  
   `evaluateContract(gapRecord, archetypeId)` returns `{ satisfied, reason?, incomplete? }`. Used by the convergence runner and any dashboard/reporting.

3. **Convergence runner** (`scripts/convergence-runner.js`)  
   Loads targets (repo + archetype) from `config/convergence-targets.json` (or `.local` / `CONVERGENCE_TARGETS_PATH`). Each iteration: gap analysis per target → contract check → research agenda (optional) → builder-gap-pulse for unsatisfied repos. Stops when all satisfy or `--max-iterations`.

4. **Targets** (`config/convergence-targets.json`)  
   `targets: [{ "repo": "HowtoWatchStream-SmartKB", "archetype": "content_kb" }, ...]`. Override with `convergence-targets.local.json` or `--repos A,B,C`.

## Commands

```bash
npm run convergence              # index + loop until all targets satisfy or max iterations
npm run convergence:no-index     # same, skip indexing
npm run convergence -- --no-index --max-iterations 20 --force-queue
npm run convergence -- --repos HowtoWatchStream-SmartKB,payclaw  # override targets (archetype defaults to content_kb)
```

## Archetypes (current)

| Archetype       | Required sections (summary) |
|-----------------|----------------------------|
| `content_kb`     | admin_setup, auth, email_setup, webhooks_signature_verify, observability, security_sweep, capability_factory_health, feature_benchmark_vs_exemplar |
| `saas_starter`  | Same as content_kb (stripe optional) |
| `payments`      | content_kb + stripe_checkout, stripe_webhooks |
| `full`          | All sections |

## Proving it

- **SmartKB** → `content_kb`: contract still fails (auth, email_setup, observability, security_sweep, capability_factory_health incomplete); runner pulses only SmartKB.
- **mytutor** → `saas_starter`: contract **OK** (all required sections complete).
- **payclaw** → `payments`: contract **OK** (all required sections complete).

So the flow is generic: one runner, multiple repos/archetypes, contract-based stop condition.

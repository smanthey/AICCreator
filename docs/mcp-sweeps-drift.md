## MCP Pattern Drift Sweeps

This document explains how QA agents should use MCP `search_symbols` to detect drift away from the canonical core modules in `claw-architect/core/*`.

### 1. Inputs

- Mission configuration: `config/mission-openclaw-architect.json` → `mcp_sweeps.drift_symbol_checks`.
- Domain exemplars: `config/domain-exemplars.json`.
- Core modules: `core/stripe.js`, `core/email.js`, `core/queue.js`, `core/trading.js`, plus future `core/auth` and `core/pm2`.

### 2. Procedure

For each domain listed in `drift_symbol_checks`:

1. Determine the set of repos to scan:
   - All target SaaS repos from `config/mission-openclaw-architect.json.target_saas_repos`.
   - Any additional repos relevant to that domain from `config/domain-exemplars.json`.
2. For each symbol name in the domain’s `drift_symbol_checks` entry (e.g. `\"handleStripeWebhook\"`, `\"sendEmail\"`):
   - Use MCP `search_symbols` with:
     - `repo`: each repo from step 1.
     - `query`: the symbol name.
3. For each result, classify whether the implementation:
   - Lives inside a core module (e.g. `core/stripe.js`) → **expected**.\n   - Lives outside core but delegates directly to core → **acceptable**.\n   - Implements domain logic independently without calling core → **drift**.\n4. For each drift instance, open a refactor task that specifies:
   - Repo, file, and symbol name.
   - Which core module/API should be used instead.
   - Any gaps in core that must be filled before replacement (so implementation agents can extend core first).

### 3. Output

- A queue of refactor tasks driving SaaS repos toward exclusive use of `core/*` modules for their domains.
- Daily or weekly drift metrics for mission reporting:
  - Drift count per domain (Stripe, email, queue, trading, auth, PM2).
  - Drift count per target SaaS repo.


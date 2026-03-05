## External Exemplar Repo Onboarding

This document defines the lightweight process OpenClaw architect and agents should follow to add new external repositories as exemplars for core domains.

### 1. When to Add an External Repo

Add a repo as an exemplar when it clearly demonstrates one or more of:

- High-quality Stripe/billing flows (checkout, webhooks, subscriptions).
- Robust email/notification flows (provider abstraction, webhooks, analytics).
- Well-structured queue/retry/DLQ patterns.
- Strong trading, auth, or PM2/process management patterns.

### 2. Onboarding Steps

1. **Propose the repo**
   - Record the GitHub URL or `owner/repo` string.
   - Note which domains it is exemplary for (e.g. `stripe`, `email`, `queue`).

2. **Index via MCP**
   - Use the MCP `index_repo` tool with the provided URL or `owner/repo`.
   - Wait for indexing to complete so the repo appears in `list_repos`.

3. **Update domain exemplars config**
   - Edit `config/domain-exemplars.json` to add the new repo identifier under the appropriate domain keys.
   - Keep the list small and curated per domain (only high-signal repos).

4. **(Optional) Create a local mirror**
   - If tighter control is desired, clone the repo into `claw-repos/` and run `index_folder` so it appears as a `local/*` entry in MCP.

5. **Refresh pattern specs**
   - On the next research cycle, include the new repo in `search_symbols` runs for the relevant domains.
   - If better patterns are discovered, update the corresponding docs in `docs/core-*-pattern.md` and plan any core/* improvements.

### 3. Responsibilities

- **Architect**: approves exemplar additions and ensures `config/domain-exemplars.json` stays consistent.
- **Research agents**: use new exemplars in MCP queries and update pattern specs as needed.
- **Implementation/QA agents**: treat updated specs and core modules as the new authority when refactoring SaaS repos.


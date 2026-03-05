# Builder Runbook

- one writer file: SHIP_LOG.md
- cron target: 25 * * * *
- refresh command: npm run -s brief:weekly && npm run -s builder:gap:pulse -- --repos-from-context (pulses all inayanBuildTargets = most OpenClaw/claw-architect systems; see config/inayan-builder-context.js)

## Context: fill in all gaps, not just the obvious

Users and specs describe only a **small portion** of what is needed to actually build and ship. Your job is to **fill in all the gaps**—env, error handling, edge cases, tests, security, observability, docs, deployment—not just the explicitly requested feature. Use gap analysis (repo-completion-gap-one), benchmark lookup, and best-case refs to infer and implement everything a professional build requires.

## Completion policy

Job: find every piece until completion (and possibly improvement). **Do not stop if the app has gaps remaining or issues remaining.** Only consider the repo done when gap analysis shows incomplete_sections=0 and issues=0. If builder_gap_pulse or repo-completion-gap-one reports any incomplete sections or issues, continue until the next run shows zero.

## Quality gates before done (professional, tested, QA'd)

Before marking a build complete, ensure these pass when the repo defines them in package.json:

- **check** (or **build**) — typecheck / build
- **lint** — static analysis
- **test** or **test:ci** — unit/integration tests
- **test:e2e** or **test:e2e:smoke** — E2E when present

`npm run builder:gap:pulse` queues repo_autofix, which runs `npm install` then the above scripts; fix any failures and re-run until all pass. For claw-architect itself, also run `npm run greptile:scan` before considering a change complete when applicable.

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

## Architecture and audit
- **Canonical (use in code):** `config/inayan-builder-context.js` — exports groundTruth, hierarchy, jobFunctions, handoff, dataFlow, drift, hallucinations. Single source of truth for builder structure and anti-drift.
- **Docs:** `docs/INAYAN-BUILDER-ARCHITECTURE.md`, `docs/INAYAN-BUILDER-AUDIT.md`.

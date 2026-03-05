# Builder professional completion (tested, QA'd as best possible)

This doc defines how the Inayan builder (and builder-gap-pulse / repo_autofix flow) treats a build as **complete in a professional, tested, and QA'd way**.

---

## 1. Context: specs describe only a small portion

People only describe a **small portion** of what is actually needed to build and ship. Your job is to **fill in all the gaps**, not just complete the obvious. Use gap analysis, benchmark lookup, and best-case refs to infer and implement the full set: the asked-for behavior plus env, error handling, edge cases, tests, security, observability, and whatever else makes the build shippable and maintainable.

---

## 2. Completion policy

- **Job:** Find every piece until completion (and possibly improvement).
- **Do not stop** while the app has **gaps remaining** or **issues remaining** (per repo-completion-gap-one / capability factory).
- **Done** means: `incomplete_sections=0`, `issues=0`, **and** quality gates below have been run and passed (or explicitly skipped with reason).

---

## 3. Quality gates (run before marking a build complete)

When the repo defines these in **package.json** scripts, run them and fix failures before considering the build complete:

| Script | Purpose | When to run |
|--------|--------|-------------|
| **check** | Typecheck / build | If present (repo_autofix runs it) |
| **build** | Production build | If present |
| **lint** | Static analysis | If present and no `check` |
| **test** or **test:ci** | Unit/integration tests | If present |
| **test:e2e** or **test:e2e:smoke** | E2E tests | If present |

**repo_autofix** (queued by builder-gap-pulse) runs: `npm install`, then the above scripts in order. If any step fails, it queues site_fix_plan and site_audit; the builder should fix failures and re-run until all pass.

---

## 4. Gap context passed to the builder

When builder-gap-pulse queues **repo_autofix** and **opencode_controller**, it includes in **gap_context**:

- **incomplete_sections** — sections still to complete
- **benchmark_lookup** — GitHub/Reddit search and best-case refs per section
- **issues** — capability factory issues (e.g. FORBIDDEN_PATTERN, MULTITENANT_BASELINE_MISSING)
- **next_actions** — suggested actions
- **quality_gate_scripts** — `["check", "build", "lint", "test", "test:ci", "test:e2e", "test:e2e:smoke"]` so the executor knows which npm scripts to run for professional completion

---

## 5. Research and improvement

- Use **builder-research-agenda** (`npm run builder:research:agenda -- --repo <name>` or `--rolling`) to get GitHub/Reddit search suggestions per incomplete section and issue.
- Use **repo-completion-benchmark-lookup** and **best_case_sources** from config to implement missing sections like a professional (exemplar repos, docs/EMAIL_RESEND_MIGRATION.md, etc.).
- After implementing, re-run **repo-completion-gap-one** and **repo_autofix** (via builder-gap-pulse) until gaps=0, issues=0, and quality gates pass.

---

## 6. References

- **Runbook:** docs/REPO-FULL-COMPLETION-GAP-RUNBOOK.md (Step 4.5)
- **Builder identity:** agent-state/agents/builder/SOUL.md, AGENTS.md
- **Gap pulse:** scripts/builder-gap-pulse.js
- **Autofix checks:** agents/repo-autofix-agent.js (`plannedChecks`)

# Inayan Builder — Drift & Hallucination Audit

**Canonical data:** `config/inayan-builder-context.js` (use in code: `require('../config/inayan-builder-context.js')` or from project root `require('./config/inayan-builder-context.js')`). Exports: `groundTruth`, `drift`, `hallucinations`, `structuralGaps`, `recommendations`, `references`.

**Audit date:** 2026-03-04

**Builder scope:** Targets from master list (local override or env; no repo names in git). Refresh uses `--repos-from-context`. **Next to complete to 100%:** set `INAYAN_NEXT_REPOS` (comma-separated); focus run: `--repos <name>`. Current next: **HowtoWatchStream-SmartKB** — see `docs/INAYAN-NEXT-TARGETS.md`.

---

## Summary

- **Ground truth:** Builder identity (SOUL/AGENTS), agent-team config (refresh = brief:weekly + builder:gap:pulse --repos-from-context, writer = SHIP_LOG), inayanBuildTargets = most OpenClaw systems, agent-team-cycle (appends to SHIP_LOG), brief:weekly (writes ~/notes/briefs/weekly only), builder-gap-pulse (gap analysis → queue repo_autofix + opencode_controller), workers (repo_autofix, opencode_controller), research-agenda (separate, not in refresh), InayanBuilderBot (external; no auto-call from pulse).
- **Drift (fixed or documented):** SHIP_LOG vs brief:weekly (doc fixed); indexing (loop = jCodeMunch, builder run = symbol-map); builder scope = inayanBuildTargets via --repos-from-context; AGENTS refresh command (fixed); planner catalog (builder task types added).
- **Hallucinations:** brief:weekly ≠ SHIP_LOG update; orchestrate can reference builder via planner task types, execution = run CLI; InayanBuilderBot not called by loop code.
- **Recommendations:** Keep docs aligned with context module; policy lives in builder-gap-pulse.js; use this context for learning and anti-hallucination.

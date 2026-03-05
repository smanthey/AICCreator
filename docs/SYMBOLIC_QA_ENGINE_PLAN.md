# Symbolic QA Engine Plan

## Goal

Build a QA system that is faster and more actionable than browser-only E2E by making symbols the primary unit of triage and implementation.

## Core Loop

1. Collect failures (PM2 logs, browser console, network failures, test assertions).
2. Map failures to likely owning symbols using indexed metadata.
3. Generate targeted repro checks for those symbols first.
4. Run minimal deterministic probes (CDP/network/contract) before full UI flows.
5. Escalate only unresolved cases to broader browser tests.

## Why It Beats Pure Playwright

- Less brute-force clicking, more ownership mapping.
- Faster feedback by narrowing the failure blast radius.
- Better task routing by domain (payments, webhooks, auth, queue, QA).
- Lower token and compute cost through symbol-level context packs.

## Initial Build Targets

1. `symbol_failure_mapping`
2. `cdp_network_contracts`
3. `auto_wait_stability`
4. `selector_resilience`
5. `visual_regression_baselines`
6. `trace_replay_debug`

## Data Backbone

- `symbol_exemplar_repos`
- `symbol_exemplar_symbols`
- `symbol_feature_playbooks`

These tables are populated by `scripts/symbolic-qa-hub.js` and used to queue feature implementation tasks, with `local/quantfusion` prioritized.


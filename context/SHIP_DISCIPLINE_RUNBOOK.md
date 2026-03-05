# Ship Discipline Runbook

Operational runbook for post-feature closure.

## Sequence (must follow in order)
1. Refactor pass
- Identify pain points from implementation diff.
- Refactor names/abstractions for clarity.

2. Test pass
- Run feature tests.
- Run affected integration tests.
- Run relevant policy/schema checks.

3. Contract pass
- If payload changed, update `schemas/payloads.js` and contract notes.
- If policy behavior changed, update policy docs and assertions.

4. Documentation pass
- Architecture notes in `docs/`.
- Operator runbook updates in `context/`.

5. Changelog pass
- Append concise entry in `~/notes/dev/CHANGELOG.md`.

## Required Artifacts
- PR summary with named pain points.
- Test output summary (pass/fail, gaps).
- Updated docs/context/schema references.
- Changelog line item with risk notes.

## Escalation
If any critical test is failing or skipped:
- mark release as blocked,
- create fix tasks by severity,
- rerun only affected suites, then global gate.

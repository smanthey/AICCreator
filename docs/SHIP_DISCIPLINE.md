# Ship Discipline (Post-Feature Standard)

Applies after every feature, fix, or automation change.

## Required Post-PR Checklist

1. Refactor pain points
- Name the pain points explicitly in PR notes (e.g., duplicate logic, weak naming, hidden side-effects).
- Refactor the highest-impact pain points before merge.

2. Add tests
- Add/adjust tests for:
  - schema validation
  - policy gates/denials
  - edge cases and failure paths
- No skipped critical tests in launch-critical paths.

3. Update docs
- `docs/`: architecture and behavior changes.
- `context/`: operational runbook updates (how to run, diagnose, recover).
- `schemas/`: payload/contract updates and compatibility notes.

4. Record changelog entry
- Add short entry to `~/notes/dev/CHANGELOG.md`:
  - what changed
  - known risks
  - follow-up items

## Definition of Done
A feature is not "done" unless all four sections above are complete.

## Fast Failure Rule
If test/doc/schema/changelog steps are missing, block release and return to patch phase.

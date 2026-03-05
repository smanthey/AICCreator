# Schema Discipline Notes

Use this when a feature changes task payloads or contracts.

## Required on payload changes
- Update `schemas/payloads.js` contract shape.
- Keep backward compatibility where possible.
- Add/adjust validation tests for:
  - required fields
  - boundary values
  - forbidden extra fields (where relevant)

## Required docs updates
- Document changed payload keys and defaults in PR notes.
- Add operational implications in `context/` runbooks.

## Risk to track
- Runtime mismatch between producers/consumers.
- Queueing tasks with stale payload shape.
- Silent drops from validation failures.

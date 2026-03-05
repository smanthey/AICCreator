# Alignment Gate Runbook

## When to run
- Any significant feature, architecture change, or cross-system modification.

## Procedure
1. Record gate with `alignment:gate` command.
2. If no owner response, proceed with safe defaults:
   - dry-run
   - read-only
   - no destructive actions
3. Execute smallest safe implementation slice first.
4. Validate with targeted tests before broad rollout.
5. Update docs/context/changelog after implementation.

## Failure prevention
- Avoid ambiguous scope.
- Do not start mutating operations without explicit confirmation.
- Keep logs/artifacts for auditability in `~/notes/dev/alignment/`.

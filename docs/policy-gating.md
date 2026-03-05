# Policy gating

All task execution is gated by policy. The worker calls `evaluateTaskPolicyWithExternal(task)` before running any handler. No bypass.

## Flow

1. **Local policy** (`control/policy-engine.js`): blocked types, read-only mode, batch limits, path prefixes, destructive flags.
2. **Optional OPA** (`control/opa-client.js`): if `POLICY_USE_OPA=true`, task input is sent to OPA; Rego rules can add deny reasons. Fail-closed for mutating tasks when OPA is unavailable.

## Policy input schema (OPA and local)

Sent to OPA as `{ input: taskInput }`. Built by `buildPolicyInput(task)` in `control/policy-engine.js`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string \| null | Task UUID |
| `type` | string | Task type (e.g. migrate, send_email, classify) |
| `plan_id` | string \| null | Plan UUID if part of a plan |
| `payload` | object | Task payload (type-specific) |
| `context.read_only_mode` | boolean | POLICY_READ_ONLY_MODE env |
| `context.mutating_task` | boolean | Whether type is in MUTATING_TYPES |
| `context.blocked_types` | []string | POLICY_BLOCKED_TASK_TYPES env |
| `context.policy_allowed_path_prefixes` | []string | POLICY_ALLOWED_PATH_PREFIXES env |
| `context.policy_disable_destructive_flags` | boolean | POLICY_DISABLE_DESTRUCTIVE_FLAGS env |

## OPA response

- **allowed**: true iff no deny reasons.
- **deny**: list of strings (reasons). If any, allowed is false.
- Local policy is always evaluated first; OPA can add more denials. Both must allow for execution.

## Rego package and endpoint

- Package: `claw.policy`
- OPA URL: `OPA_URL` (default `http://127.0.0.1:8181/v1/data/claw/policy`)
- Request body: `{ "input": taskInput }`

## Current Rego rules (policy/opa/claw-policy.rego)

- Read-only mode blocks mutating task types.
- Blocked task types (from env) are denied.
- Destructive payload flags: delete, overwrite_all, force_delete.
- Path fields (path, source_path, dest_path): must not match blocked_prefix and must match allowed_prefix.
- **Action-type gating:** High-impact types (`migrate`, `send_email`, `brand_provision`, `github_add_repo`) require `plan_id` to be set (non-empty); ad-hoc execution is denied.
- **Credit/loyalty gating:** When `payload.requires_approval == true`, `payload.approved` must be true; otherwise the task is denied. Use this for LLM-suggested credit or loyalty actions that must pass an approval step before execution.

## References

- `control/policy-engine.js` — evaluateTaskPolicy, buildPolicyInput, evaluateTaskPolicyWithExternal
- `control/opa-client.js` — evaluateOpaPolicy
- `policy/opa/claw-policy.rego` — Rego rules
- `workers/worker.js` — calls evaluateTaskPolicyWithExternal before running handler

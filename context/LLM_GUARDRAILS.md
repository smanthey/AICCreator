# LLM guardrails

LLMs are used for specific task types. They act as a **suggestion layer**: outputs are never executed raw. All actions pass through policy, payload schema validation, and evidence/audit.

## Where LLMs are used

| Task type | Role | Queue |
|-----------|------|-------|
| classify | Semantic tagging on file_index (Ollama/local or remote) | claw_tasks_ai |
| triage | Error diagnosis (Claude Haiku) | claw_tasks_ai |
| judge | Verdict / quality assessment | claw_tasks_ai |
| patch | Code fix (Claude Sonnet, git branch) | claw_tasks_ai |
| orchestrate | Multi-goal planning and merged plan dispatch | claw_tasks_ai |
| analyze_content | Content analysis / summarization | claw_tasks_ai |
| generate_copy | Copy generation | claw_tasks_ai |
| aicreator | AI-assisted creation flows | claw_tasks_ai |
| site_fix_plan | Site fix planning (LLM) | claw_tasks_ai |
| site_extract_patterns | Pattern extraction (LLM) | claw_tasks_ai |
| report | Plan synthesis report (orchestrator sub-goal output) | claw_tasks_infra |

Handlers may return `follow_up_tasks`; those are inserted as new tasks and go through the same policy and schema validation.

## Guardrails

1. **Structured output**: Payloads are validated by [schemas/payloads.js](../schemas/payloads.js) before execution. Worker and inserter call `validatePayload(type, payload)`. LLM-generated or planner-generated payloads are rejected if they fail schema.
2. **Policy gate**: Every task is evaluated by [evaluateTaskPolicyWithExternal](../control/policy-engine.js) before the handler runs. Blocked types, read-only mode, paths, destructive flags, and optional OPA rules apply. No bypass.
3. **Evidence / audit**: Task results and plan history are persisted. Mutating or high-stakes actions are logged; evidence is always recorded for audit and rollback.

**Rule:** LLM suggestions must pass policy and schema; evidence is always logged. LLMs do not subscribe to events directly; they run as tasks triggered by plans or follow-up tasks.

## References

- [policy-gating.md](../docs/policy-gating.md)
- [schemas/payloads.js](../schemas/payloads.js)
- [agents/registry.js](../agents/registry.js) — handler registration
- [config/task-routing.js](../config/task-routing.js) — queue and tags

# Agent Communication Research Pack

Generated: 2026-03-03

## What was added to index

- Inserted/updated 18 high-signal sources into `knowledge_sources`:
  - 12 repo sources
  - 6 paper sources
- Seeder report: `reports/agent-comm-source-seed-latest.json`

## Practical improvements to implement now

1. Standardize message envelope across agent/subagent/swarm hops.
- Required fields: `trace_id`, `span_id`, `plan_id`, `task_id`, `idempotency_key`, `agent_id`, `intent`, `priority`, `deadline`, `retry_count`, `schema_version`, `payload_hash`.
- Benefit: deterministic replay and cross-lane correlation.

2. Enforce protocol negotiation and capability handshake.
- At session start, exchange capabilities for tools, streaming support, push callbacks, and auth modes.
- Cache peer capability card with TTL and schema checksum.

3. Add exactly-once semantics to long-running task delivery.
- Use publish dedupe keys + ack confirmation (double-ack pattern) for critical transitions.
- Make all state transition writes idempotent by (`task_id`, `state`, `version`).

4. Use adaptive communication topology.
- Do not keep fixed all-to-all swarm chat for every task.
- Apply manager-as-tool for bounded tasks and handoff mode for conversational tasks.
- Prune agent graph depth/breadth dynamically when token burn rises.

5. Propagate trace context inside protocol payload metadata.
- Carry W3C `traceparent`/`tracestate` in protocol metadata (`_meta`) for MCP-style calls.
- Emit spans for each handoff, tool call, and queue transition.

6. Harden handoff validity checks.
- Validate handoff target capability before transfer.
- Require pairing of tool-call + tool-result messages on handoff boundaries.
- Reject malformed history fragments before they hit downstream agents.

7. Add fail-storm protocol fallback policy.
- On queue/latency spike, route from rich-protocol mode to low-overhead mode.
- Use health-based protocol router thresholds (latency p95, delivery failure rate, retry storm count).

8. Guardrail placement strategy.
- Blocking guardrails for expensive or external-side-effect actions.
- Parallel guardrails for low-cost/no-side-effect actions.
- Tool guardrails on unsafe tools (shell, patch, external webhook).

## Source set highlights

- OpenAI Agents orchestration + handoffs + tracing
- MCP 2025-06-18 specification
- A2A protocol specification (task lifecycle, streaming, push notifications)
- AutoGen group-chat and selector-manager patterns
- LlamaIndex multi-agent patterns (workflow, orchestrator, custom planner)
- NATS JetStream exactly-once semantics guidance
- OpenTelemetry messaging + MCP semantic conventions
- W3C Trace Context standard
- 2025 MAS communication surveys and protocol-selection papers

## Runbook

```bash
npm run -s research:agent-comm:seed
npm run -s pattern:robust:build
npm run -s qa:symbolic:hub
npm run -s progress:enforce
```

## Immediate KPI targets

- Handoff failure rate: < 1.0%
- Duplicate transition writes: 0
- Message re-delivery rate for critical tasks: < 0.1%
- Mean recovery time from fail-storm: -20% versus current baseline
- Cross-agent trace coverage: > 95% of queue transitions

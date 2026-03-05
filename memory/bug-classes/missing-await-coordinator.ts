import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "coordination",
  type: "bug_class",
  name: "missing_await_on_async_coordinator",
  summary:
    "Async coordinator methods called without await return Promises that are always truthy, silently bypassing coordination logic.",
  invariants: [
    "All coordinator methods that perform I/O or asynchronous work (shouldAgentRun, loadHealthState, getBudgetState, shouldThrottle) are declared async.",
    "Every call site to these async coordinator methods uses await and handles the resolved decision struct.",
  ],
  failure_modes: [
    "Agents that should be blocked run anyway because Promise objects are treated as truthy.",
    "Agents that should run are blocked because decision fields are undefined on the unresolved Promise.",
    "Coordinators appear to work (no crashes) while making systematically wrong decisions.",
  ],
  severity: "critical",
  detection_query: {
    type: "search_text",
    pattern: "shouldAgentRun(",
    file_pattern: "scripts/*agent-runner.js",
  },
  unsafe_pattern: "const decision = coordinator.shouldAgentRun(",
  safe_pattern: "const decision = await coordinator.shouldAgentRun(",
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "scripts/mission-control-agent-runner.js",
    symbol: "runAgentOnce",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "control/system-health-coordinator.js",
    symbol: "shouldAgentRun",
  },
  notes: [
    "See MEMORY.md entries for 2026-03-02 missing-await fixes in mission-control-agent-runner.js and status-review-agent-runner.js.",
    "When copying coordination blocks between runners, always audit every coordinator method call for await.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["bug-class", "async", "coordination", "await"],
});


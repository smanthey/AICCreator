import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "numeric-safety",
  type: "bug_class",
  name: "unguarded_numeric_formatting",
  summary:
    "Calling .toFixed() or .toLocaleString() on undefined/null values from DB or external state causes TypeError crashes.",
  invariants: [
    "All numeric values originating from DB rows, external APIs, or partially-built state objects are normalized with Number(x || 0) before formatting.",
    "Deeply nested numeric fields use optional chaining plus Number(x || 0) before .toFixed() or arithmetic.",
  ],
  failure_modes: [
    "TypeError: Cannot read properties of undefined (reading 'toFixed') in hot paths such as budget gates and dashboards.",
    "Divide-by-zero bugs when day counters or denominators are not guarded.",
  ],
  severity: "high",
  detection_patterns: [".toFixed(", ".toLocaleString("],
  unsafe_pattern: ".toFixed(",
  safe_pattern: "Number(value || 0).toFixed(",
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "control/cost-coordinator.js",
    symbol: "getBudgetGate",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "scripts/openclaw-coordinator-pulse.js",
  },
  notes: [
    "See MEMORY.md deep pattern audit for unguarded .toFixed() across control/* and scripts/*.",
    "Guard denominators in divisions using || 1 to avoid divide-by-zero in forecasts.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["bug-class", "numeric", "toFixed", "safety"],
});


import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "database",
  type: "rule",
  name: "no_gen_random_uuid_on_nas",
  summary:
    "NAS Postgres instances may not have pgcrypto enabled; never rely on DEFAULT gen_random_uuid(), always generate UUIDs in Node.",
  invariants: [
    "All INSERT statements into tasks and similar tables explicitly provide an id generated via crypto.randomUUID() in Node.js.",
    "No table in NAS Postgres relies on gen_random_uuid() as a DEFAULT for primary keys.",
  ],
  failure_modes: [
    'INSERT failures with "null value in column \\"id\\" violates not-null constraint" on NAS-backed tables.',
  ],
  severity: "high",
  unsafe_pattern: "DEFAULT gen_random_uuid()",
  safe_pattern: "const id = crypto.randomUUID();",
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "scripts/device-utilization.js",
    symbol: "generateWorkForDevice",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "control/inserter.js",
  },
  notes: [
    "See MEMORY.md entry: device-utilization.js — null id on INSERT (pgcrypto unavailable on NAS).",
    "Pattern should match inserter.js: UUID generated in Node and passed as parameter to INSERT.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["rule", "postgres", "uuid", "nas"],
});


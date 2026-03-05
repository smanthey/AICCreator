export type MemoryDomain =
  | "stripe"
  | "pm2"
  | "redis"
  | "queue"
  | "uptime"
  | "security"
  | "email"
  | "architecture"
  | "agent_system"
  | "deployment"
  | (string & {});

export type MemoryType =
  | "pattern"
  | "incident"
  | "decision"
  | "fix"
  | "architecture"
  | "runbook"
  | "landmine"
  | "bug_class"
  | "rule"
  | (string & {});

export interface CanonicalImplementationRef {
  repo: string;
  file: string;
  symbol: string;
}

export interface RelatedCoreModuleRef {
  repo: string;
  file: string;
  symbol?: string;
}

export interface MemoryObject {
  /** High-level area this memory belongs to (stripe, queue, uptime, etc.) */
  domain: MemoryDomain;
  /** Kind of memory: pattern, incident, decision, fix, architecture, etc. */
  type: MemoryType;
  /** Stable machine name, used as the symbol id (unique within domain+type). */
  name: string;
  /** One-line summary of what this memory encodes. */
  summary: string;
  /** Why this matters; the core invariant(s) that must remain true. */
  invariants: string[];
  /** Typical failure modes when this invariant is violated. */
  failure_modes?: string[];
  /** Optional severity for bug classes / incidents (e.g. low, medium, high, critical). */
  severity?: "low" | "medium" | "high" | "critical" | (string & {});
  /** Optional unsafe code/text pattern associated with this memory. */
  unsafe_pattern?: string;
  /** Optional safe code/text pattern associated with this memory. */
  safe_pattern?: string;
  /** Optional list of detection patterns (for sweeps/search). */
  detection_patterns?: string[];
  /** Optional structured detection query description. */
  detection_query?: {
    type: string;
    pattern: string;
    file_pattern?: string;
  };
  /** Canonical implementation to look at before making changes. */
  canonical_implementation?: CanonicalImplementationRef;
  /** Where in the core system this memory is expected to apply. */
  related_core_module?: RelatedCoreModuleRef;
  /** Freeform notes, links, or runbook pointers (kept short). */
  notes?: string[];
  /** Semantic version for this memory object. */
  version: string;
  /** ISO timestamp (UTC) of last time this was verified against reality. */
  last_verified: string;
  /** Optional tags to aid search / filtering. */
  tags?: string[];
}

export function defineMemory<T extends MemoryObject>(memory: T): T {
  return memory;
}


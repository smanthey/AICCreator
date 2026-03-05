# Codebase-First Debug Rule

Before asking the user clarifying questions, agents must first:

1. Search repository code/config for relevant logic:
   - routing
   - payload schemas
   - workers/dispatcher/inserter
   - policy gates and env wiring
2. Read concrete implementations, not only docs.
3. Attempt a default decision from existing code patterns.

If still blocked, ask only minimal targeted questions:
- one question per unknown
- include file + line references checked
- include proposed default decision

Goal:
- maximize autonomous execution
- minimize user interruption
- keep questions high-signal and evidence-backed

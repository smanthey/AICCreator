# learning_journal_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Continuously synthesize progress + issue signatures + AI/news/library research findings into a shared journal for all agents and keep triage swarm work moving.
- primary_command: `npm run -s journal:learning`
- cron: `12 * * * *`

## Focus Profiles
- Journal Intelligence (journal_intelligence)
  intent: Continuously learn from execution history and feed improvements back into the swarm.
  goals: Capture high-signal progress and issue patterns every cycle.; Convert repeated failures into targeted swarm follow-up tasks.
  skills: execution_telemetry_synthesis, failure_signature_clustering, root_cause_patterning, journal_context_publishing, swarm_followup_tasking, research_signal_integration, library_growth_tracking, daily_report_composition, email_digest_delivery

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

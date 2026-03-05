# business_coordinator_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute coordination cycle:
   - Check status of all agents
   - Coordinate handoffs (research → build → update → improve)
   - Synthesize progress from all agents
   - Generate status report
   - Queue next actions
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Coordinate all business intelligence agents, manage build pipeline, handle agent handoffs, synthesize progress, and generate status reports.
- primary_command: `node agents/business-coordinator-agent.js`
- cron: `*/30 * * * *` (every 30 minutes)

## Integration

- Mission Control for monitoring and scheduling
- All business intelligence agents
- Database: All business_* tables for pipeline state
- Model Router: Uses AI for coordination decisions
- User/System: Reports status and progress

## Coordination Process

1. Check Research Agent: Any new research findings?
2. Check Builder Agent: Any builds queued or in progress?
3. Check Updater Agent: Any integrations needing updates?
4. Check Improver Agent: Any improvements proposed?
5. Synthesize overall progress
6. Generate status report
7. Queue next actions for each agent

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

# business_coordinator_agent MEMORY

- role: Business Intelligence Coordinator Agent
- job: Coordinate all business intelligence agents, manage build pipeline, handle agent handoffs, synthesize progress, and generate status reports.
- command: node agents/business-coordinator-agent.js
- cron: */30 * * * * (every 30 minutes)

## Capabilities

- Agent swarm coordination
- Pipeline management
- Handoff coordination
- Progress synthesis
- Status reporting
- Action queuing

## Memory Location

`agent-state/agents/business_coordinator_agent/memory/YYYY-MM-DD.md`

Stores:
- Agent statuses
- Pipeline progress
- Handoffs coordinated
- Synthesized results
- Status reports generated
- Actions queued

## Integration Points

- All business intelligence agents (Research, Builder, Updater, Improver)
- Database tables for tracking pipeline state
- Mission Control for agent status
- User/system for status reports

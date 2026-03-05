# business_updater_agent MEMORY

- role: Business Intelligence Updater Agent
- job: Monitor all integrations for health, detect API changes or deprecations, update code, handle authentication renewals, and fix broken connections.
- command: node agents/business-updater-agent.js
- cron: 30 */6 * * * (every 6 hours, 30 minutes after builder)

## Capabilities

- Integration health monitoring
- API change detection
- Code update generation
- Authentication renewal handling
- Error recovery and fixing
- Update testing and validation

## Memory Location

`agent-state/agents/business_updater_agent/memory/YYYY-MM-DD.md`

Stores:
- Integrations monitored
- API changes detected
- Updates applied
- Authentication renewals
- Errors fixed
- Health status improvements

## Integration Points

- `business_data_sources` table for integration status
- `business_sync_logs` table for error detection
- Builder Agent patterns for code updates
- Coordinator Agent for status reporting

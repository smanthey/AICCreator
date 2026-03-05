# business_builder_agent MEMORY

- role: Business Intelligence Builder Agent
- job: Generate sync scripts from research findings, create database migrations, set up API authentication, implement error handling, and add integrations to sync scheduler.
- command: node agents/business-builder-agent.js
- cron: 15 */6 * * * (every 6 hours, 15 minutes after research)

## Capabilities

- Sync script generation from templates
- Database migration creation
- API authentication implementation
- Error handling and retry logic
- Integration with sync scheduler
- Code testing and validation

## Memory Location

`agent-state/agents/business_builder_agent/memory/YYYY-MM-DD.md`

Stores:
- Builds completed
- Scripts generated
- Migrations created
- Authentication methods implemented
- Errors encountered
- Build patterns learned

## Integration Points

- `business_build_queue` table for build tasks
- `business_integration_research` table for research findings
- Updater Agent monitors built integrations
- Coordinator Agent manages build pipeline

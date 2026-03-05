# business_builder_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute build cycle:
   - Check build queue for research findings
   - Generate sync script using build patterns
   - Create migration if needed
   - Implement authentication
   - Add error handling
   - Test generated code
   - Deploy to system
   - Queue for Updater Agent monitoring
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Generate sync scripts from research findings, create database migrations, set up API authentication, implement error handling, and add integrations to sync scheduler.
- primary_command: `node agents/business-builder-agent.js`
- cron: `15 */6 * * *` (every 6 hours, 15 minutes after research)

## Integration

- Mission Control for monitoring and scheduling
- Database: `business_build_queue` and `business_integration_research` tables
- Research Agent: Consumes research findings
- Updater Agent: Monitors built integrations
- Coordinator Agent: Manages build pipeline
- Model Router: Uses AI for code generation
- Build Patterns: Follows `.cursor/rules/business-build-patterns.mdc`

## Build Process

1. Read research from `business_integration_research`
2. Generate sync script following template
3. Create migration if schema changes needed
4. Implement authentication flow
5. Add error handling and retries
6. Test code syntax and structure
7. Deploy script to `scripts/` directory
8. Update build queue status
9. Queue for Updater Agent

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

# business_updater_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute update cycle:
   - Check all integrations for health
   - Detect API changes or deprecations
   - Update code using patterns
   - Test updates
   - Deploy fixes
   - Verify health restored
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Monitor all integrations for health, detect API changes or deprecations, update code, handle authentication renewals, and fix broken connections.
- primary_command: `node agents/business-updater-agent.js`
- cron: `30 */6 * * *` (every 6 hours, 30 minutes after builder)

## Integration

- Mission Control for monitoring and scheduling
- Database: `business_data_sources` and `business_sync_logs` tables
- Builder Agent: Uses patterns for code updates
- Coordinator Agent: Reports health status
- Model Router: Uses AI for code updates

## Update Process

1. Query all connected integrations
2. Check sync logs for errors
3. Detect API deprecations or changes
4. Generate code updates
5. Test updates
6. Deploy fixes
7. Verify integration restored

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

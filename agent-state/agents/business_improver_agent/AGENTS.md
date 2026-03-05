# business_improver_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute improvement cycle:
   - Analyze system metrics
   - Identify optimization opportunities
   - Generate improvements
   - Test improvements
   - Deploy optimizations
   - Track impact
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Analyze system metrics, identify optimization opportunities, generate improvements, test and deploy optimizations, and enhance dashboard features.
- primary_command: `node agents/business-improver-agent.js`
- cron: `45 */6 * * *` (every 6 hours, 45 minutes after updater)

## Integration

- Mission Control for monitoring and scheduling
- Database: `business_improvement_logs` and `business_sync_logs` tables
- Coordinator Agent: Receives improvement priorities
- Dashboard: Enhances with new features
- Model Router: Uses AI for optimization analysis

## Improvement Process

1. Query performance metrics
2. Identify bottlenecks and gaps
3. Generate improvement proposals
4. Test improvements
5. Deploy optimizations
6. Measure impact
7. Log to improvement_logs

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

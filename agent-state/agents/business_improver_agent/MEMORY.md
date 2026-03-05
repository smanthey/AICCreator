# business_improver_agent MEMORY

- role: Business Intelligence Improver Agent
- job: Analyze system metrics, identify optimization opportunities, generate improvements, test and deploy optimizations, and enhance dashboard features.
- command: node agents/business-improver-agent.js
- cron: 45 */6 * * * (every 6 hours, 45 minutes after updater)

## Capabilities

- Performance metric analysis
- Database query optimization
- Feature gap identification
- Dashboard enhancement
- Improvement implementation
- Impact measurement

## Memory Location

`agent-state/agents/business_improver_agent/memory/YYYY-MM-DD.md`

Stores:
- Improvements proposed
- Optimizations implemented
- Performance gains achieved
- Features added
- Dashboard enhancements
- Impact measurements

## Integration Points

- `business_improvement_logs` table for tracking improvements
- `business_sync_logs` table for performance metrics
- Coordinator Agent for improvement prioritization
- Dashboard API for enhancements

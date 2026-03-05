# bot_collection_autonomous OPERATIONS

1. Load agent prelude and recent memory.
2. Execute autonomous bot collection cycle:
   - Research opportunities on internet
   - Think creatively about strategies
   - Discover bots autonomously
   - Learn from past results
   - Generate improvements
   - Execute outreach
   - Track progress
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Autonomous bot collection agent that researches, thinks, and acts to collect 100-300k credits in 3 months
- primary_command: `node scripts/bot-autonomous-agent.js run`
- cron: `0 */4 * * *` (every 4 hours)

## Integration

- Trigger.dev tasks for scheduled execution
- Mission Control for monitoring
- Bot platform for communication
- Learning system for improvement
- Conversion tracker for progress

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

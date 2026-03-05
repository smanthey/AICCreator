# business_research_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute research cycle:
   - Check research queue for new platforms
   - Research API documentation
   - Identify authentication methods
   - Test API endpoints
   - Assess integration complexity
   - Generate research report
   - Queue findings for Builder Agent
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Research new platforms to integrate (Shopify, Etsy, Amazon, Shippo, PirateShip, social media, analytics), test APIs, and generate research reports for Builder Agent.
- primary_command: `node agents/business-research-agent.js`
- cron: `0 */6 * * *` (every 6 hours)

## Integration

- Mission Control for monitoring and scheduling
- Database: `business_integration_research` table
- Builder Agent: Consumes research findings
- Coordinator Agent: Manages priorities and handoffs
- Model Router: Uses AI for complex research tasks

## Research Process

1. Identify platform to research
2. Find official API documentation
3. Research authentication methods (OAuth, API key, webhook, etc.)
4. Identify available endpoints and data
5. Test API accessibility
6. Document rate limits and constraints
7. Assess integration complexity
8. Generate research report
9. Store in `business_integration_research` table
10. Queue for Builder Agent

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

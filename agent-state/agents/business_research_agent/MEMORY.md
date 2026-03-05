# business_research_agent MEMORY

- role: Business Intelligence Research Agent
- job: Research new platforms to integrate (Shopify, Etsy, Amazon, Shippo, PirateShip, social media, analytics), test APIs, and generate research reports for Builder Agent.
- command: node agents/business-research-agent.js
- cron: 0 */6 * * * (every 6 hours)

## Capabilities

- Platform discovery and identification
- API documentation research
- Authentication method identification
- API endpoint testing
- Rate limit discovery
- Data availability assessment
- Research report generation

## Memory Location

`agent-state/agents/business_research_agent/memory/YYYY-MM-DD.md`

Stores:
- Platforms researched
- API findings
- Authentication methods discovered
- Test results
- Integration complexity assessments
- Research notes and learnings

## Integration Points

- `business_integration_research` table for storing findings
- Builder Agent consumes research findings
- Coordinator Agent manages research priorities

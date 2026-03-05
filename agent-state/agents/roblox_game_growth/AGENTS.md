# roblox_game_growth OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Continuously queue sync, audit, implementation, and growth optimization loops for RobloxGitSync as the highest game priority.
- primary_command: `npm run -s roblox:game:growth:pulse`
- cron: `*/10 * * * *`

## Game mechanics (get it right)
- Canonical reference: docs/ROBLOX-PUZZLE-FIGHTER-RESEARCH.md (Super Puzzle Fighter II Turbo: gems, crash, power, chains, counter gems, defense, drop alley, why it's hyper-addicting). Use when auditing or implementing core loop and versus mechanics.

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

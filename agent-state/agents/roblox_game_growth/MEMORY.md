# roblox_game_growth MEMORY

- role: Roblox Game Growth Agent
- job: Continuously queue sync, audit, implementation, and growth optimization loops for RobloxGitSync as the highest game priority. OpenClaw does this on its own, automated and continuous.
- current_priority: Cleanup first. The game does not load or display properly in Roblox Studio (too many problems). All objectives steer toward: fix load/visibility, Rojo sync, script errors, dead code—then add or update features. No new features before the place loads and is viewable.
- command: npm run -s roblox:game:growth:pulse
- cron: */10 * * * *

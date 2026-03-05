# OpenClaw 10-Agent Mission Control

This architecture defines 10 specialized agents for the git repo system, each with:

- persistent memory in `agent-state/agents/<agent_id>/`
- scheduled cron execution via PM2 (`claw-mission-<agent_id>`)
- heartbeat monitoring (`claw-mission-heartbeat`)
- explicit job descriptions from config

## Source of Truth

- config: `config/mission-control-agents.json`
- initializer: `scripts/mission-control-init.js`
- runner: `scripts/mission-control-agent-runner.js`
- heartbeat: `scripts/mission-control-heartbeat.js`

## Agents

1. `saas_development` — capability rollout and SaaS baseline hardening.
2. `content_writing` — draft generation lane (safe dry-run command by default).
3. `research_analysis` — proactive research trigger detection.
4. `data_processing` — indexing and deterministic data refresh.
5. `scheduling_calendar` — orchestration/schedule dependency planning.
6. `code_review` — blocking QA and high-risk code review.
7. `debugging` — regression scan and debug queue fueling.
8. `ui_ux_design` — workflow walkthrough UX quality checks.
9. `marketing_social` — affiliate/growth research pipeline.
10. `system_administration` — runtime health and platform operations.

## Setup

```bash
cd $HOME/claw-architect
npm run mission:control:init
pm2 start ecosystem.background.config.js --only claw-mission-heartbeat,claw-mission-saas_development,claw-mission-content_writing,claw-mission-research_analysis,claw-mission-data_processing,claw-mission-scheduling_calendar,claw-mission-code_review,claw-mission-debugging,claw-mission-ui_ux_design,claw-mission-marketing_social,claw-mission-system_administration
pm2 save
```

## Manual Commands

```bash
# run one agent on demand
npm run mission:control:run -- --agent saas_development

# run heartbeat report
npm run mission:control:heartbeat
```

## Outputs

- per-run reports: `scripts/reports/*-mission-control-<agent_id>.json`
- latest agent report: `scripts/reports/mission-control-<agent_id>-latest.json`
- heartbeat latest: `scripts/reports/mission-control-heartbeat-latest.json`
- daily memory logs: `agent-state/agents/<agent_id>/memory/YYYY-MM-DD.md`

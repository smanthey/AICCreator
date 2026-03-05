# Swarm Must-Complete: Indexing and Flow Powerups

## Purpose

This is the operational checklist for all agents and mission lanes. Items below are required, not optional.

## Checklist

1. Symbol-aware task briefs  
Status: `baseline live`  
Source: dispatcher payload enrichment via `_symbol_context`.

2. Cross-repo drift detection  
Status: `baseline live`  
Source: `scripts/payclaw-drift-pulse.js` + PM2 cron.

3. Auto best-source reuse hints  
Status: `baseline live`  
Source: context pack includes top exemplar hints.

4. Failure-to-symbol triage  
Status: `baseline live`  
Source: `scripts/pm2-failure-symbol-triage.js` + PM2 cron.

5. Change-impact scoring  
Status: `baseline live`  
Source: `control/change-impact.js` + `control/symbol-context.js` (`change_impact` in `_symbol_context`).
Requirement: score changed symbols + downstream dependencies; gate test depth by score.

6. Queue routing by symbol domain  
Status: `baseline live`  
Source: `control/symbol-context.js` emits `domains` + `worker_hints`; `control/dispatcher.js` attaches `_worker_routing_hints`.
Requirement: merge symbol domain tags into routing decisions.

7. Duplicate implementation suppression  
Status: `pending`  
Requirement: detect same-purpose symbols across repos, route to canonical implementation.

8. Auto test-target generation  
Status: `baseline live`  
Source: `control/change-impact.js` + `control/symbol-context.js` (`test_targets.checks` + `test_targets.targeted_commands`).
Requirement: map critical symbols to smoke/unit target commands automatically.

9. Prompt token compression  
Status: `baseline live`  
Source: `control/change-impact.js` + `control/symbol-context.js` (`prompt_compression` includes symbol IDs/files).
Requirement: use symbol IDs + summaries in prompts by default.

10. Knowledge freshness loop  
Status: `in progress`  
Current: PM2 repomap refresh is live.  
Remaining: architecture snapshot + scheduled index refresh consolidation.

11. Daily rotating feature delivery for every target repo  
Status: `baseline live`  
Source: `scripts/daily-feature-rotation.js` + PM2 app `claw-daily-feature-rotation`.  
Rule: each day each target repo receives 1-2 feature implementation tasks with required exemplar OSS comparison and best-case implementation.

12. Symbolic QA exemplar hub (central best-of-best DB)  
Status: `baseline live`  
Source: `scripts/symbolic-qa-hub.js` + PM2 app `claw-symbolic-qa-hub`.  
Rule: maintain a centralized table of top symbols by QA feature across internal + OSS repos, then auto-queue implementation tasks (QuantFusion first).

13. Closed self-correction 8-step chains  
Status: `baseline live`  
Source: `control/closed-loop.js` + `scripts/closed-loop-daily.js` + PM2 app `claw-closed-loop-daily`.  
Rule: run test->map->fix->retest dependency chains automatically, not single-pass task drops.

## Enforcement

- Agents should reference this checklist in planning and report status deltas when they implement or improve any item.
- New flow/ops scripts should declare which checklist item(s) they satisfy.

# capture_usage_report_hardener OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Enforce daily major-update commit lane for capture, clear compile debt, verify scheduled usage-report execution, and keep release checks trustworthy.
- primary_command: `npm run -s repo:priority:major:daily -- --only capture`
- cron: `*/30 * * * *`

## Focus Profiles
- Infra Reliability (infra_reliability)
  intent: Keep runtime stable, fast, and continuously moving.
  goals: Maintain green core runtime lanes.; Reduce retry/dead-letter rates weekly.
  skills: pm2_service_lifecycle, bullmq_queue_recovery, postgres_runtime_diagnostics, redis_health_remediation, startup_reconciliation, idempotent_retries, observability_instrumentation, safe_autonomous_restarts
- Repo Engineering (repo_engineering)
  intent: Deliver high-leverage code improvements across repos quickly.
  goals: Increase successful implementation throughput.; Reduce duplicate implementations across repos.
  skills: symbol_aware_scoping, repo_mapper_entrypoint_analysis, cross_repo_pattern_reuse, change_impact_scoring, targeted_test_generation, schema_safe_refactoring, incremental_patch_strategy, failure_driven_fix_loop, benchmark_guided_implementation

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

# cookiespass_finisher OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Run cookiespass:mission:pulse as highest priority. Reuse implementations from existing repos for speed and reliability; do not rebuild from scratch. Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper when available to map entrypoints/dependencies before coding.
- primary_command: `npm run -s cookiespass:mission:pulse`
- cron: `*/20 * * * *`

## Focus Profiles
- Infra Reliability (infra_reliability)\n  intent: Keep runtime stable, fast, and continuously moving.\n  goals: Maintain green core runtime lanes.; Reduce retry/dead-letter rates weekly.\n  skills: pm2_service_lifecycle, bullmq_queue_recovery, postgres_runtime_diagnostics, redis_health_remediation, startup_reconciliation, idempotent_retries, observability_instrumentation, safe_autonomous_restarts\n- Repo Engineering (repo_engineering)\n  intent: Deliver high-leverage code improvements across repos quickly.\n  goals: Increase successful implementation throughput.; Reduce duplicate implementations across repos.\n  skills: symbol_aware_scoping, repo_mapper_entrypoint_analysis, cross_repo_pattern_reuse, change_impact_scoring, targeted_test_generation, schema_safe_refactoring, incremental_patch_strategy, failure_driven_fix_loop, benchmark_guided_implementation

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.

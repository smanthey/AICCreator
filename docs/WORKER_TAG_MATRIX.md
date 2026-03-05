# BullMQ Worker Tag Matrix

Canonical reference for how worker tags map to queues and how task types are classified (engine / AI / actuator). Used for ops and for event-driven task spawning (mediated swarm).

## Tag → Queues

Workers subscribe to queues based on `WORKER_TAGS` (env). Single source of truth: `workers/worker.js` `TAG_QUEUES` and `config/task-routing.js` `TASK_ROUTING`.

| Tag           | Queues |
|---------------|--------|
| `infra`       | claw_tasks, claw_tasks_infra |
| `deterministic` | claw_tasks_io_heavy |
| `io_heavy`    | claw_tasks_io_heavy |
| `cpu_heavy`   | claw_tasks_cpu_heavy |
| `ai`          | claw_tasks_ai |
| `qa`          | claw_tasks_qa |
| `io_light`    | claw_tasks, claw_tasks_io (legacy) |
| `llm_local` / `llm_remote` | claw_tasks_llm, claw_tasks_ai (legacy) |

All workers also consume `claw_tasks` (control tasks). See `workers/worker.js` `resolveQueues()`.

## Task type → queue (TASK_ROUTING)

Canonical source: `config/task-routing.js`. Summary by category:

### Engine (deterministic)

- **claw_tasks_infra:** echo, report, research_sync, research_signals, platform_health_report, security_*, loyalty_webhook_ingest, loyalty_process_webhooks
- **claw_tasks_io_heavy:** index, media_detect, media_enrich, media_hash, cluster_media, dedupe, migrate, claw_search/stats/recent, fetch_content, fetch_leads, send_email, github_*, site_audit, site_compare, repo_autofix, brand_provision, loyalty_send_outreach, loyalty_maintenance
- **claw_tasks_cpu_heavy:** media_hash, cluster_media, dedupe

### AI (LLM)

- **claw_tasks_ai:** classify, triage, judge, patch, orchestrate, analyze_content, generate_copy, aicreator, site_fix_plan, site_extract_patterns

### QA

- **claw_tasks_qa:** qa_run, qa_spec, qa_pack

### Conceptual mapping (events / docs)

For event-driven spawns and docs, we use:

- **tasks.engine.*** — work that runs on infra / io_heavy / cpu_heavy (deterministic or I/O bound).
- **tasks.ai.*** — work that runs on claw_tasks_ai (LLM).
- **tasks.actuator.*** — work that performs external side effects (send_email, migrate, github_add_repo, brand_provision, loyalty_send_outreach). These are a subset of engine/ai queues; routing is still via TASK_ROUTING.

When creating tasks from domain events (e.g. event bus consumer), use the existing inserter or follow-up path so the dispatcher and `config/task-routing.js` determine the queue; no separate “actuator queue” exists.

## TAG_TAXONOMY

`config/task-routing.js` exports `TAG_TAXONOMY`: infra, deterministic, ai, qa, cpu_heavy, io_heavy.

## References

- `workers/worker.js` — TAG_QUEUES, resolveQueues, QUEUE_CONCURRENCY
- `config/task-routing.js` — TASK_ROUTING, resolveRouting, isKnownTaskType

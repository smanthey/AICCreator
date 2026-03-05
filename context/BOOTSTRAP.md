# Bootstrap Context

> Loaded at worker startup and injected into orchestrator/planner as initial context.
> Describes the system state, available resources, and startup checks.

---

## System Topology

```
[Telegram] ──► [Gateway: claw-gateway pm2]
                    │
                    ▼
             [Postgres pg_notify] ──► [Workers: claw-worker-llm pm2]
                    │                       │
                    │              ┌────────┴──────────┐
                    │              ▼                    ▼
                    │         [BullMQ Queues]    [Agents Registry]
                    │         claw_tasks              echo
                    │         claw_tasks_llm          report
                    │         claw_tasks_qa           index/classify
                    │                                 dedupe/migrate
                    │                                 triage/patch/judge
                    │                                 qa-agent
                    │                                 orchestrator  ← NEW
                    │                                 planner
                    │
                    └──► [NAS Postgres 192.168.1.164:15432]
                              Database: claw_architect
                              Tables: plans, tasks, task_results,
                                      file_index, qa_results,
                                      content_items, content_briefs,
                                      model_usage, leads, brands,
                                      telegram_users
```

---

## Startup Checks (run on worker init)

1. ✅ Redis connected (192.168.1.42:6379)
2. ✅ Postgres connected (192.168.1.164:15432/claw_architect)
3. ✅ Anthropic API key present
4. ⚠️ GEMINI_API_KEY — add when available
5. ⚠️ DEEPSEEK_API_KEY — add when available
6. ✅ Ollama available at localhost:11434 (llama3 model)
7. ✅ claude CLI available (Max subscription routing)

---

## Queue Tags (this worker)

| Tag         | Queues                                    | Purpose                    |
|-------------|-------------------------------------------|----------------------------|
| io_light    | claw_tasks                                | Echo, report, index, dedupe|
| llm_local   | claw_tasks, claw_tasks_llm               | Ollama + Claude tasks      |
| qa          | claw_tasks_qa                             | Playwright QA tests        |

---

## Model Cost Budget (per plan)

| Alert Level | Est. Cost  | Action                           |
|-------------|------------|----------------------------------|
| Info        | < $1.00    | Silent                           |
| Warn        | $1–5       | Note in plan summary             |
| Confirm     | > $5       | Require Telegram approval first  |

---

## Key Database Tables

- **plans** — orchestrated plan records (plan_id, goal, intent_tier, status)
- **tasks** — individual task records (linked to plan via plan_id)
- **task_results** — JSON results from each completed task
- **model_usage** — LLM call costs per task (tracks savings vs API-only)
- **file_index** — SHA-256 indexed files with semantic classification
- **content_items** — Social media posts fetched per brand/platform
- **content_briefs** — AI-generated content strategy briefs

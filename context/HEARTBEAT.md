# Heartbeat & Health Monitoring

> Context injected into monitoring agents and the Telegram /status command handler.

---

## What a Healthy System Looks Like

```
[gateway]   online | restarts: 0-2 (normal) | uptime > 10min
[worker]    online | restarts: 0-5 (normal) | uptime > 10min
[redis]     connected | memory < 150MB | no evictions (noeviction policy set)
[postgres]  connected | reachable at 192.168.1.164:15432 | response < 500ms
[ollama]    available at localhost:11434 | llama3 model loaded
[queue]     waiting: 0-10 (normal) | active: 0-4 | failed: 0 (alert if > 0)
```

---

## Alert Thresholds

| Metric                    | Warning        | Critical         |
|---------------------------|----------------|------------------|
| pm2 restarts (per hour)   | > 3            | > 10             |
| Redis memory              | > 150MB        | > 200MB          |
| Dead letter queue depth   | > 5            | > 20             |
| Failed tasks (24h)        | > 10           | > 50             |
| Plan cost (single plan)   | > $1.00        | > $5.00          |
| LLM API cost (24h total)  | > $2.00        | > $10.00         |
| Postgres response time    | > 500ms        | > 2000ms         |

---

## Heartbeat Checks (run every 60s by worker)

1. **Redis ping** — `PING` → `PONG`
2. **Postgres ping** — `SELECT 1`
3. **Queue depth** — BullMQ `getJobCounts()` on all queues
4. **Dead letter check** — count failed jobs in past hour
5. **Memory guard** — `process.memoryUsage().rss` < 500MB

Heartbeat result stored in `worker_heartbeats` table:
```sql
(worker_id, checked_at, redis_ok, postgres_ok, queue_waiting, queue_active,
 queue_failed, memory_rss_mb, status)
```

---

## Recovery Playbook

### Worker keeps restarting
1. Check: `pm2 logs claw-worker-llm --lines 50`
2. Common causes: Redis connection refused → check 192.168.1.42:6379
3. Common causes: Postgres unreachable → check NAS power + network
4. Common causes: Missing env var → check .env has all required keys

### 409 Telegram conflict
1. `ps aux | grep telegram` → find stale gateway PID
2. `kill <PID>` → remove stale process
3. `pm2 restart claw-gateway` → clean restart

### Dead letter queue growing
1. Check task type with highest failure rate via:
   `SELECT type, COUNT(*) FROM tasks WHERE status='failed' GROUP BY type ORDER BY 2 DESC`
2. Look at error in task_results for that type
3. Fix agent code → redeploy → retry failed jobs

### Model costs spiking
1. Check model_usage table: `SELECT model_key, SUM(cost_usd) FROM model_usage WHERE created_at > NOW() - INTERVAL '24h' GROUP BY model_key`
2. If Anthropic API being hit more than expected → check if claude CLI (sub) is failing
3. Verify GEMINI_API_KEY and DEEPSEEK_API_KEY are set (cheap fallbacks)

---

## Status Command Response Format

```
🟢 ClawdBot Status
─────────────────
Gateway:  online (24m uptime)
Worker:   online (4m uptime, 2 restarts)
Redis:    ✅ 12MB used
Postgres: ✅ 45ms response
Queue:    waiting=2 active=1 failed=0
Models:   sub=✅ gemini=⚠️(no key) deepseek=⚠️(no key) api=✅
Cost 24h: $0.023 (13 LLM calls)
─────────────────
Last task: analyze_content → brand=plushtrap (2m ago)
```

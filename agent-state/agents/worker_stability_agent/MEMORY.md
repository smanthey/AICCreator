# worker_stability_agent MEMORY

- role: Worker Stability Agent
- job: Analyze PM2 logs for restart patterns, check memory leaks, monitor connection pools, investigate Ollama conflicts, implement fixes.
- command: npm run -s status:review:worker
- cron: */30 * * * *

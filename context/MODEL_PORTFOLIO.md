# Model Portfolio (Local + API)

This system supports a multi-model portfolio and routes tasks by lane.

## Lanes

- `coding-best`:
  - `qwen3-coder:30b`
  - `codestral:22b`
  - Used by: `patch`, `qa_spec` fallback stack
- `reasoning`:
  - `deepseek-r1:14b`, `deepseek-v3`
  - Used by: `triage`, `judge`, analysis escalation
- `general`:
  - `qwen3:32b`, `qwen3:14b`, `qwen3:7b`, `mistral-small:24b`
  - Used by: website/content generation and strategy tasks
- `edge-light`:
  - `qwen3:1.7b`, `llama3.2:3b`, `gemma2:2b`
  - Used for lightweight classify/fallback lanes on low-RAM devices

## Router behavior

- Primary provider for most AI tasks is `ollama`.
- Fallbacks: `openai` then `anthropic`.
- Per-task model overrides steer best-fit model families.
- Budgets and confidence thresholds remain enforced.

## Runtime options

- Ollama local endpoint:
  - `OLLAMA_HOST=http://127.0.0.1:11434`
- OpenAI-compatible endpoint (OpenAI / LM Studio / Jan / vLLM / gateway):
  - `OPENAI_BASE_URL=http://127.0.0.1:<port>/v1`
  - `OPENAI_API_KEY=<required-by-server-or-placeholder>`

## Validation commands

```bash
npm run model:portfolio
npm run model:portfolio -- --pull-missing
npm run model:routing:stats
```

## Notes

- Pull only models that fit each machine's RAM/disk budget.
- For 8GB devices, prioritize `edge-light` + `qwen3:7b`.
- For 16GB devices, add `qwen3:14b` and `deepseek-r1:14b`.
- Use the M3/NAS-backed nodes for heavier models and throughput.

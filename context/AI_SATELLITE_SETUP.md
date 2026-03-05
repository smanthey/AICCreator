# AI Satellite Setup (M1 Laptop + M1 Desktop)

Use this on secondary devices so they contribute AI capacity without running control-plane jobs.

## 1) Prereqs

- Homebrew installed
- Node.js/npm installed
- Repo cloned at `$HOME/claw-architect`

Install required tools:

```bash
brew install ollama
npm i -g pm2
cd $HOME/claw-architect
npm install
```

## 2) Env on each satellite (`.env`)

Set at minimum:

```bash
POSTGRES_HOST=192.168.1.164
POSTGRES_PORT=15432
POSTGRES_DB=claw_architect
POSTGRES_USER=claw
POSTGRES_PASSWORD=...your_password...

REDIS_HOST=192.168.1.164
REDIS_PORT=16379

CLASSIFY_PROVIDER=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL_FAST=llama3
OLLAMA_CLASSIFY_MODEL=llama3

# Optional API fallback keys:
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...
```

## 3) Pull models locally

```bash
ollama serve &
ollama pull llama3
```

Recommended portfolio (pull what fits each device RAM/disk):

```bash
# lightweight / edge
ollama pull llama3.2:3b
ollama pull qwen3:1.7b
ollama pull gemma2:2b

# general purpose
ollama pull qwen3:7b
ollama pull qwen3:14b
ollama pull mistral-small:24b

# reasoning / coding (heavier)
ollama pull deepseek-r1:14b
ollama pull qwen3-coder:30b
ollama pull codestral:22b
```

Audit what is actually present + warm:

```bash
npm run model:portfolio
# or auto-pull missing tags:
npm run model:portfolio -- --pull-missing
```

If you use LM Studio or Jan AI as OpenAI-compatible servers, point:

```bash
OPENAI_BASE_URL=http://127.0.0.1:<port>/v1
OPENAI_API_KEY=<dummy-or-real-key-required-by-that-server>
```

## 4) Start AI satellite PM2 profile

Use a unique satellite name per device:

```bash
cd $HOME/claw-architect
SATELLITE_NAME=m1-laptop npm run pm2:ai-satellite:start
# or on desktop:
# SATELLITE_NAME=m1-desktop npm run pm2:ai-satellite:start
pm2 save
```

This starts:

- `<name>-ollama`
- `<name>-worker-ai`
- `<name>-ollama-maint` (every 10 min)

## 5) Verify health

On satellite:

```bash
pm2 status
curl -s http://127.0.0.1:11434/api/tags
npm run ollama:maintenance
```

On primary control machine:

```bash
cd $HOME/claw-architect
npm run verify:topology
npm run status:redgreen
```

You should see higher active `ai_worker` count in topology.

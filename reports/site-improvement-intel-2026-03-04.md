# Site Improvement Intel — 2026-03-04

One-shot run: **MCP health** → **index all git repos** → **Reddit search** → **GitHub repo scout** → **OSS benchmark**. Use this to improve your sites (Skyn Patch, BWS, CopyLab, PayClaw, Mission Control, etc.).

---

## 1. MCP tools

- **Status:** All 7 checks passed (trigger, postgres, filesystem, github, jcodemunch, context7, github_server_boot).
- **Indexing:** 42 repos indexed via jCodeMunch CLI; 3 skipped (no source files: RobloxGitSync, Cookies_Pass, reframed). Use **jcodemunch** MCP for symbol search in Cursor, or `GET /api/search?repo=local/<name>&q=...` via jcodemunch-api (port 4055).

---

## 2. Your repos now indexed (symbol search ready)

| Repo | Files | Symbols |
|------|------:|--------:|
| claw-architect | 473 | 3418 |
| v0-skyn-patch | 303 | 863 |
| LeadGen3 | 303 | 3569 |
| Inbound-cookies | 359 | 2243 |
| Madirectory | 357 | 3970 |
| SmartKB | 287 | 3382 |
| oss-index | 383 | 3634 |
| capture | 148 | 1037 |
| CookiesPass / TempeCookiesPass | 101–102 | 552–557 |
| payclaw, autopay_ui | 24 each | 76, 309 |
| … plus 30 more | — | — |

---

## 3. Reddit — best posts for “better OSS / site builders”

Query: *best open source dashboard chat UI site builder 2024 2025*

**Use these to improve your sites:**

- **OpenClaw / dashboard / chat:** [Two weeks later with OpenClaw and this is what I've learned](https://www.reddit.com/r/openclaw/comments/1rf0vz6/) (r/openclaw), [The original OpenClaw 101](https://www.reddit.com/r/openclaw/comments/1qzyibu/) — direct feedback and patterns for your stack.
- **Claude Code / builder:** [Claude Code is a Beast – Tips from 6 Months](https://www.reddit.com/r/ClaudeAI/comments/1oivjvm/), [Cataloguing Claude Code tools (with links)](https://www.reddit.com/r/ClaudeAI/comments/1ofltdr/) — tooling and UX ideas.
- **Open-source alternatives / site builder:** [RIP Postman free tier – open-source local-first alternative](https://www.reddit.com/r/webdev/comments/1qyi3wz/) — positioning and “open-source alternative” framing for landing pages.
- **Analytics / dashboard:** [My open source web analytics platform reached 10,000 Github stars](https://www.reddit.com/r/webdev/comments/1plouh4/) — what resonates for OSS dashboards.
- **AI + product:** [What people are building with Claude Skills (with links)](https://www.reddit.com/r/ClaudeAI/comments/1o9ph4u/), [System that makes claude code understand what you want to build](https://www.reddit.com/r/ClaudeAI/comments/1lm9pfp/) — product and UX inspiration.

Full list: `reports/reddit-search-research-latest.md` (186 posts indexed).

---

## 4. GitHub scout — top “better version” repos (dashboard/chat UI)

Scout filters for **chat + dashboard UI**, ranks by stars + UI signals. Top candidates to clone or learn from:

| Repo | Stars | Why use it |
|------|------:|------------|
| **Mintplex-Labs/anything-llm** | 55k | All-in-one Docker/Desktop: RAG, agents, no-code builder, **MCP**. Strong chat + dashboard paths. |
| **langgenius/dify** | 131k | Production agentic workflows; low-code; **MCP**; Next.js. You already have it in managed repos. |
| **infiniflow/ragflow** | 74k | RAG + Agent; **MCP**; document parsing; strong admin/chat UI. |
| **simstudioai/sim** | 27k | Build/deploy/orchestrate AI agents; Next.js; chat + studio UI. You have it locally. |
| **f/prompts.chat** | 150k | Share/discover prompts; self-host; Next.js; admin UI — good reference for “community + prompts” sites. |

**Already in your managed repos:** dify, sim. Consider adding: **anything-llm**, **ragflow**, **prompts.chat** for UI/UX and feature patterns.

Full scout report: `scripts/reports/dashboard-chatbot-repo-scout-latest.json` (and `.md`).

---

## 5. OSS dashboard benchmark — top scorers

| Rank | Repo | Score | Notes |
|-----:|------|------:|------|
| 1 | danny-avila/LibreChat | 107 | Chat, webui, multi-model, MCP. |
| 2 | open-webui/open-webui | 104 | WebUI, self-hosted, Ollama, MCP. |
| 3 | casibase/casibase | 102 | Chat, admin UI, multi-model, MCP. |
| 4 | lobehub/lobehub | 97 | Chat UI, multi-model, MCP. |
| 5 | langflow-ai/langflow | 82 | Chat, flow UI. |
| 6 | FlowiseAI/Flowise | 79 | Chat, chatbot UI. |
| 7 | Mintplex-Labs/anything-llm | 74 | See scout above. |

Use these for: **chat layout**, **model picker UX**, **self-hosted + MCP** positioning. Full table: `reports/oss-dashboard-benchmark-latest.md`.

---

## 6. How to use this to improve your sites

- **Skyn Patch / lead gen:** Borrow “open-source alternative” and “self-hosted” framing from Reddit; mirror OSS benchmark repos’ landing structure.
- **Mission Control / dashboard:** Align tabs and chat UX with LibreChat / open-webui / anything-llm; add MCP/agent hints where relevant.
- **PayClaw / Autopay UI:** Use dify/sim for workflow and settings screens; prompts.chat for “templates” or “presets” UX.
- **CopyLab / BWS:** Use Reddit “what people are building” and “10k stars” post patterns for social proof and positioning.
- **Index more / re-index:**  
  `./scripts/mcp-index-everything.sh | .venv-openclaw-tools/bin/python scripts/jcodemunch-index-paths.py`  
  Or in Cursor, use jCodeMunch MCP **index_folder** for a single path.

---

## Commands reference

```bash
# MCP health
npm run mcp:health

# Index all repos (CLI, no MCP needed)
./scripts/mcp-index-everything.sh | .venv-openclaw-tools/bin/python scripts/jcodemunch-index-paths.py

# Reddit research
npm run reddit:search -- --query "your query"

# GitHub scout (dashboard/chat repos)
npm run dashboard:repo:scout

# OSS benchmark
npm run oss:dashboard:benchmark
```

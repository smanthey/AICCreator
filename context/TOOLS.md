# Tools & Capabilities

> Reference for what ClawdBot can do. Injected into orchestrator when decomposing goals.

---

## Task Types (Agent Capabilities)

### Data & Files
| Task           | What it does                              | Cost    | Tier |
|----------------|-------------------------------------------|---------|------|
| `index`        | SHA-256 scan + incremental delta index    | $0      | 1    |
| `classify`     | Ollama semantic tagging of indexed files  | $0      | 1    |
| `dedupe`       | Find duplicates by SHA-256                | $0      | 1    |
| `migrate`      | Copy files to ClawVault with verification | $0      | 2    |
| `claw_search`  | Full-text search over file_index          | $0      | 0    |
| `claw_stats`   | Library statistics                        | $0      | 0    |
| `claw_recent`  | Recently indexed files                    | $0      | 0    |

### Code & QA
| Task           | What it does                              | Cost       | Tier |
|----------------|-------------------------------------------|------------|------|
| `triage`       | LLM diagnosis of errors/failures          | ~$0.001    | 1    |
| `judge`        | Pass/fail check on triage output          | ~$0.002    | 1    |
| `patch`        | Code fix → git branch (never deploys)     | ~$0.01     | 3    |
| `qa_spec`      | Playwright YAML spec runner               | $0 compute | 2    |

### Content & Marketing
| Task              | What it does                           | Cost       | Tier |
|-------------------|----------------------------------------|------------|------|
| `fetch_content`   | Scrape YouTube/TikTok/Instagram posts  | API cost   | 1    |
| `analyze_content` | LLM content strategy brief             | ~$0.001    | 1    |
| `generate_copy`   | Email/caption/product copy             | ~$0.001    | 1    |
| `fetch_leads`     | Google Places B2B lead scraper         | ~$0.017/req| 2    |
| `send_email`      | Send via Maileroo (single email)       | $0         | 3    |

### Orchestration & Planning
| Task          | What it does                              | Cost       | Tier |
|---------------|-------------------------------------------|------------|------|
| `plan`        | Decompose goal → task DAG                 | ~$0.005    | auto |
| `orchestrate` | Multi-step goal with sub-task routing     | ~$0.05     | auto |
| `report`      | Human-readable plan/result summary        | ~$0.001    | 0    |
| `echo`        | Smoke test / passthrough                  | $0         | 0    |

### GitHub
| Task                | What it does                          | Cost | Tier |
|---------------------|---------------------------------------|------|------|
| `github_sync`       | Clone/pull managed repos              | $0   | 1    |
| `github_repo_status`| Read-only repo status                 | $0   | 0    |
| `github_add_repo`   | Register a new client repo            | $0   | 1    |

---

## Model Router — Provider Tiers

| Tier | Models                              | When Used                          |
|------|-------------------------------------|------------------------------------|
| 0    | claude CLI (Max subscription)       | All tasks, subscription-first      |
| 1    | Gemini 2.0 Flash, DeepSeek Chat     | Content, classify, triage          |
| 2    | Claude Haiku API, Gemini Pro        | Fallback from Tier 1               |
| 3    | Claude Sonnet API, DeepSeek R1      | Planning, code, complex reasoning  |
| 4    | Claude Opus 4.6 API                 | Orchestration, advanced strategy   |

---

## Integration Points

- **Telegram Bot** — user interface, approvals, status
- **Ollama (localhost:11434)** — local LLM for classify/index (llama3, free)
- **NAS Postgres** — persistent storage for all results
- **Redis** — BullMQ queues + model router rate-limit state
- **YouTube API** — video fetching (YOUTUBE_API_KEY required)
- **Apify** — TikTok/Instagram scraping (APIFY_API_KEY required)
- **Google Places API** — lead generation (GOOGLE_PLACES_KEY required)
- **Maileroo** — email sends (MAILEROO_API_KEY required)
- **GitHub API** — repo sync (GITHUB_TOKEN required)

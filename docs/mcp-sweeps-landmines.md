## MCP Landmine Sweeps

This document explains how QA and maintenance agents should run daily MCP `search_text` sweeps to detect landmines and open refactor tasks, using the patterns listed in `config/mission-openclaw-architect.json`.

### 1. Inputs

- Mission configuration: `config/mission-openclaw-architect.json` → `mcp_sweeps.landmine_search_text_patterns`.
- Indexed repos: all entries under `local/*` plus any external exemplars added to `config/domain-exemplars.json`.

### 2. Procedure

For each pattern in `landmine_search_text_patterns`:

1. Use the MCP `search_text` tool with:
   - `repo`: each `local/*` repo and any exemplar repo relevant to the mission.
   - `query`: the landmine string (e.g. `\"execSync\"`, `\".json\"`, `\"MailerSend\"`).
2. Collect the results with file paths and line numbers.
3. Classify each hit as:
   - **Landmine** (on hot paths, shared state, or production flows), or
   - **Acceptable legacy** (one-off local scripts, migrations, or intentionally isolated tooling).
4. For each landmine, open a refactor task that includes:
   - Repo and file path.
   - Short description of the issue.
   - Suggested fix (e.g. “wrap in core/queue retry helper”, “migrate JSON state to DB access layer”, “replace raw provider call with core/email”).

### 3. Output

- A list of structured tasks for the modernization queues (pm2, state, email, trigger, etc.).
- Optional summary metrics for mission reporting:
  - Landmine count per repo.
  - Landmine types (execSync, JSON, legacy providers, etc.).


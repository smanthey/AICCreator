## jCodeMunch MCP Playbook

This is a practical guide for using the `jcodemunch` MCP server to cut token costs and make better use of both cloud LLM APIs and local Ollama when working with code.

### 1. Install prerequisites (Python ≥ 3.10)

The `jcodemunch-mcp` package requires **Python 3.10 or newer**. Your current system Python is 3.9, so you need a newer Python first.

Recommended approach (macOS):

1. **Install a new Python with Homebrew (preferred)**
   ```bash
   brew install python@3.12
   ```
   This typically gives you a `python3.12` binary at a path like `/opt/homebrew/bin/python3.12`.

2. **Confirm the version**
   ```bash
   python3.12 --version
   # Expect: Python 3.12.x
   ```

3. **Install jCodeMunch MCP with that Python**
   ```bash
   python3.12 -m pip install --user git+https://github.com/jgravelle/jcodemunch-mcp.git
   ```

4. **Sanity check the CLI**
   ```bash
   jcodemunch-mcp --help
   ```
   If `jcodemunch-mcp` is not found, ensure your user `bin` directory is on `PATH` (often `~/Library/Python/3.12/bin` or `~/.local/bin`) and restart your shell.

Alternative: if you prefer `pyenv`, you can install and set a 3.10+ version via:

```bash
pyenv install 3.12.2
pyenv global 3.12.2
python -m pip install --user git+https://github.com/jgravelle/jcodemunch-mcp.git
```

### 2. Configure MCP clients

#### 2.1 Cursor / project MCP host

The project already declares `jcodemunch` in `.cursor/mcp.json`:

- Server ID: `jcodemunch`
- Command: `jcodemunch-mcp`

Once the CLI is installed and on `PATH`, Cursor-aware MCP clients for this repo can use it directly.

#### 2.2 VS Code

The repo also has a workspace-level MCP config in `.vscode/settings.json`:

- `mcp.servers.jcodemunch.command = "jcodemunch-mcp"`

Open this folder in VS Code with an MCP-capable extension and it will be able to talk to jCodeMunch.

#### 2.3 Claude Desktop / other MCP hosts

Add a server block in your global config (example for Claude Desktop):

```json
{
  "mcpServers": {
    "jcodemunch": {
      "command": "jcodemunch-mcp",
      "env": {
        "GITHUB_TOKEN": "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",
        "ANTHROPIC_API_KEY": ""
      }
    }
  }
}
```

- `GITHUB_TOKEN` (optional): higher GitHub API limits, access to private repos.
- `ANTHROPIC_API_KEY` (optional): enables cheap Haiku-based symbol summaries during indexing.

### 2.4 What to do next (Quick start)

Once your MCP client is connected, here’s the fastest “3-step” flow to start using jCodeMunch effectively.

**Policy:** Always use MCP tools and symbol-index everything before deep work. See `AGENTS.md` and **Index everything** below.

#### 1) Index this repo once (run from any MCP client)
> This builds the server-side index so future queries are fast and cheap.

```json
index_folder: { "path": "$HOME/claw-architect" }

### 3. Core workflows for this repo (`claw-architect`)

#### 3.1 Index the local repo once

From any MCP client, ask it to call:

```text
index_folder: { "path": "$HOME/claw-architect" }
```

This will:

- Walk the repo with jCodeMunch’s security filters (skipping `node_modules`, binaries, `.env`, etc.).
- Parse supported languages (JS/TS, Python, Go, Rust, Java, PHP) via tree-sitter.
- Create an index under `~/.code-index/` with a repo id like `local-claw-architect`.

Subsequent tools can refer to this repo as `local-claw-architect` (the default for a folder named `claw-architect`), for example:

```text
get_repo_outline: { "repo": "local-claw-architect" }
```

**Index everything:** To symbol-index all canonical repos (claw-architect + claw-repos/*), use the path list from `docs/MCP-INDEX-TARGETS.md` or run `scripts/mcp-index-everything.sh` and call `index_folder` for each path. See AGENTS.md → "Code Exploration Standard".

#### 3.2 Explore structure cheaply

- **High-level overview**
  ```text
  get_repo_outline: { "repo": "local-claw-architect" }
  ```
  Use this when an agent needs to understand major directories, languages, and symbol counts.

- **Browse specific areas**
  For example, the main HTTP/API server logic in `scripts/`:
  ```text
  get_file_tree: {
    "repo": "local-claw-architect",
    "path_prefix": "scripts"
  }
  ```

- **File-level API surface**
  For a specific script:
  ```text
  get_file_outline: {
    "repo": "local-claw-architect",
    "file_path": "scripts/architect-api.js"
  }
  ```
  This gives classes/functions/methods + signatures and summaries without dumping the whole file.

#### 3.3 Find and read only what you need

- **Locate a function or method**
  ```text
  search_symbols: {
    "repo": "local-claw-architect",
    "query": "uptime",
    "kind": "function",
    "file_pattern": "scripts/*.js"
  }
  ```
  Use this for things like `uptime` handlers, watchdog helpers, or PM2 utilities.

- **Retrieve minimal implementations**
  Take a returned `symbol_id` (example):
  ```text
  get_symbol: {
    "repo": "local-claw-architect",
    "symbol_id": "scripts/uptime-watchdog-agents.js::runUptimeWatchdog#function",
    "context_lines": 3
  }
  ```
  This pulls:
  - Just the function’s body.
  - A few surrounding lines for local helpers.

  For related methods in one file:
  ```text
  get_symbols: {
    "repo": "local-claw-architect",
    "symbol_ids": [
      "scripts/uptime-watchdog-agents.js::runUptimeWatchdog#function",
      "scripts/uptime-watchdog-agents.js::restartAgent#function"
    ]
  }
  ```

- **Search for non-symbol content**
  For TODOs, string literals, or config values:
  ```text
  search_text: {
    "repo": "local-claw-architect",
    "query": "TODO",
    "file_pattern": "scripts/*.js",
    "max_results": 20
  }
  ```

#### 3.4 Keep context drift-safe

When you rely on a symbol for multi-step work:

```text
get_symbol: {
  "repo": "local-claw-architect",
  "symbol_id": "scripts/architect-api.js::handlePostGoal#function",
  "verify": true,
  "context_lines": 2
}
```

- `_meta.content_verified = true` means the source still matches the index.
- If it is `false`, re-run:
  ```text
  invalidate_cache: { "repo": "local-claw-architect" }
  index_folder: { "path": "$HOME/claw-architect" }
  ```

### 4. Using jCodeMunch with cloud APIs and Ollama

#### 4.1 General flow

1. Use MCP+jCodeMunch tools to:
   - Index once (`index_folder` / `index_repo`).
   - Narrow to a small set of functions/classes (`search_symbols`).
   - Retrieve only those bodies (`get_symbol` / `get_symbols`).
2. Take the returned source snippets and include **only those** (plus minimal surrounding comments) in prompts to:
   - Cloud LLM APIs (Anthropic, OpenAI, etc.).
   - Local Ollama models.

This replaces the old pattern of “open whole file and paste everything,” which wastes tokens and slows down reasoning.

#### 4.2 Pattern for remote APIs (Anthropic, OpenAI, etc.)

For code analysis or refactors:

- **Before**: send entire `scripts/architect-api.js` (~thousands of lines).
- **After**:
  1. `search_symbols` for the 1–3 functions you actually care about.
  2. `get_symbols` with `context_lines` set low (e.g. `2` or `3`).
  3. Include only those snippets in your API prompt.

This typically cuts input tokens by **80–99%** for code-reading tasks, without losing relevant context.

#### 4.3 Pattern for Ollama

When using Ollama as a local coding assistant:

1. Let your MCP client fetch code through jCodeMunch first.
2. Send only symbol-level snippets into Ollama.
3. Use small models (e.g. `qwen`, `llama3.x`) for fast local iterations.
4. Optionally, escalate to a cloud model only for:
   - Final diff review.
   - Security audits.
   - Cross-file architectural reasoning.

Because prompts are smaller, Ollama runs:

- Faster (less time spent on tokenization and context loading).
- With lower memory pressure (smaller KV cache).

### 5. Prompt patterns for agents (any MCP client)

Add guidance like this to your system/developer prompts:

- “When working with source code, **always** use the `jcodemunch` MCP server first. Use `search_symbols` and `get_symbol` / `get_symbols` to retrieve only the functions, classes, or methods you need. Do **not** open or paste entire files unless these tools fail to find the content.”
- “To understand a file or area of the repo, use `get_repo_outline`, `get_file_tree`, and `get_file_outline` before requesting source. Only then request the specific symbols you need.”
- “Use `search_text` only when looking for string literals, comments, or config values that are not addressable as symbols.”

These rules ensure that:

- Code exploration is **symbol-first** and token-efficient.
- Cloud APIs and Ollama receive **minimal, relevant context** instead of entire files.


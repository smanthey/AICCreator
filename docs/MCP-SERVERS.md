# MCP Servers — Setup and Verification

All MCP tools used by Cursor/Claude in this workspace are launched via scripts under `scripts/` and configured in `.cursor/mcp.json`. This doc describes each server and how to keep them working.

**Loading in Cursor:** Each server uses `command: "bash"`, `args: ["./scripts/..."]`, and `cwd` set to the repo root so Cursor starts them with the correct working directory. If your repo is not at `/Users/tatsheen/claw-architect`, run `npm run mcp:sync` (it injects the current repo path) or edit `cwd` in `.cursor/mcp.json` for each server.

## Servers (in `.cursor/mcp.json`)

| Server       | Script                  | Purpose |
|-------------|--------------------------|--------|
| **trigger** | `scripts/mcp-trigger.sh` | Trigger.dev tasks, runs, deploy, docs. Needs `npx`; optional env from `.env`. |
| **jcodemunch** | `scripts/jcodemunch-mcp.sh` | Symbol indexing: `index_folder`, `index_repo`, `search_symbols`, `get_symbol`, etc. Needs Python 3.10+ and `jcodemunch-mcp` (venv at `.venv-openclaw-tools` or on PATH). |
| **postgres** | `scripts/mcp-postgres.sh` | Query and write to PostgreSQL. Needs `.env` with `POSTGRES_*` or `CLAW_DB_*` and `npm install` (binary in `node_modules/.bin/mcp-server-postgres`). Password is URL-encoded for special characters. |
| **filesystem** | `scripts/mcp-filesystem.sh` | Read/write under workspace, `$CLAW_REPOS`, `$CODEX_HOME`, and home. Uses `npx -y @modelcontextprotocol/server-filesystem`. |
| **github** | `scripts/mcp-github.sh` | GitHub repo/issue/code search. Uses `npx -y @modelcontextprotocol/server-github`. Set `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env` for API access. |
| **context7** | `scripts/mcp-context7.sh` | Upstash Context7 MCP. Uses `npx -y @upstash/context7-mcp`. Optional `CONTEXT7_API_KEY` in `.env`. |

## Verify All MCP Tools

From the repo root:

```bash
npm run mcp:health
```

This runs each script with `--healthcheck` and a quick GitHub server boot. All checks should pass. If one fails, fix the reported issue (e.g. missing env, missing binary, missing dir).

## Per-Server Notes

- **trigger**: Wrapper ensures `.env` is loaded and `npx trigger.dev@4.4.1 mcp` runs from repo root. Healthcheck only verifies `npx` is available.
- **jcodemunch**: Install with `pip install jcodemunch-mcp` (Python 3.10+) or use the project venv `.venv-openclaw-tools`. See `docs/jcodemunch.md` and `docs/MCP-INDEX-TARGETS.md`.
- **postgres**: Connection URI is built from env; password is URL-encoded so `@`, `:`, `/`, `%` in the password do not break the URI.
- **filesystem**: Only existing directories are passed to the server (workspace and home always; `CLAW_REPOS` and `CODEX_HOME` if present).
- **github**: Server starts even without a token; API calls will fail until `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN` is set.
- **context7**: If you see “Request timed out” or invalid JSON from the client, the Context7 MCP process may be writing non–JSON-RPC to stdout; consider disabling the server or updating the package.

## Paths and Env

- Scripts use `ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"` so they work when run from any cwd (e.g. Cursor runs them with workspace root as cwd).
- `.env` is sourced by postgres, github, context7, and trigger when present.
- Optional: `CLAW_REPOS`, `CODEX_HOME` for filesystem; `CONTEXT7_API_KEY` for context7.

## Not an MCP Server

- `scripts/mcp-index-everything.sh` only prints paths for indexing. Do **not** add it to `mcp.json`. Use the **jcodemunch** server and call `index_folder` for each path (see `docs/MCP-INDEX-TARGETS.md`).

## Index + Reddit + GitHub + Benchmark workflow

For a single reference that ties indexing, Reddit/GitHub search, benchmarking, repo updates, and MCP setup together, see **`docs/INDEX-REDDIT-GITHUB-BENCHMARK-WORKFLOW.md`**.

## External Skills for OpenClaw Agents

This doc lists external, MCP-indexed skills repositories that OpenClaw agents working in `claw-architect` should treat as **exemplar libraries**, plus when to reach for each.

**Indexing:** After installing any of these repos, **index them with jCodeMunch** (per-repo instructions below) so `get_repo_outline` / `search_symbols` / `get_symbol` are fast—indexing speeds everything up. See `docs/MCP-INDEX-TARGETS.md` for the policy. **Install all five:** `npm run skills:install`; then run `./scripts/mcp-index-everything.sh` and call **index_folder** for each path. Best-of repo ids and entry points: `config/external-skills-index.json`.

All of these repos are public GitHub projects. They are not vendored into `claw-architect` by default; instead, agents and operators can install them into the OpenClaw workspace (for example `~/.openclaw/workspace/skills`) or refer to them as patterns when designing new skills.

---

## 1. Anthropic Skills (`anthropics/skills`)

- **Repo:** `https://github.com/anthropics/skills`
- **Purpose:** Production-grade skills for:
  - Office/docs workflows (DOCX redlining, comments, packing/unpacking, validation).
  - PDF workflows (converting PDFs to images, checking bounding boxes, extracting form fields).
  - MCP-builder helpers for wiring tools and evaluation.

### Install snippet (workspace-level)

```bash
git clone https://github.com/anthropics/skills.git
cd skills
# Copy relevant skills into your OpenClaw workspace
cp -r skills/* ~/.openclaw/workspace/skills/
```

Adjust the destination if your OpenClaw workspace lives somewhere else.

### Symbol indexing pattern (jCodeMunch / MCP)

Once cloned into the OpenClaw workspace, index this repo once so agents can do fast symbol-level search:

- **Recommended repo id:** `anthropics-skills`
- **Root to index:** `~/.openclaw/workspace/skills/skills` (or wherever you copied the repo)
- **jCodeMunch call (conceptual):**

  - Use your `jcodemunch` MCP server’s `index_repo` tool with:
    - `repo_id`: `"anthropics-skills"`
    - `root_dir`: path to the cloned repo root
    - `include_globs`: e.g. `["**/*.py", "**/*.ts", "**/*.js", "**/*.md"]`
  - After initial indexing, future agents should call `get_repo_outline` / `search_symbols` on `anthropics-skills` instead of opening whole files.

### When to use for `claw-architect`

- **Doc/PDF workflows:** When agents need to:
  - Accept/flatten redlines in contracts or reports.
  - Validate DOCX/PPTX structure.
  - Convert PDFs to images or extract annotations/fields.
- **MCP-builder patterns:** When designing new MCP-backed tools or skills for:
  - Report generation and auditing.
  - PayClaw-style paperwork or Stripe/Payments summaries exported as docs.

Use these as **canonical examples** for how to structure file-heavy skills safely.

---

## 2. Superpowers (`obra/superpowers`)

- **Repo:** `https://github.com/obra/superpowers`
- **Purpose:** SWE lifecycle and debugging skills, including:
  - Systematic debugging workflows.
  - Graph/diagram rendering for reasoning and architecture.

### Install snippet

```bash
git clone https://github.com/obra/superpowers.git
cd superpowers
cp -r skills/* ~/.openclaw/workspace/skills/
```

### When to use for `claw-architect`

- **Debugging agents:** When modernizing or debugging:
  - Trigger.dev tasks.
  - PM2/uptime scripts.
  - Stripe/email/queue integrations.
- **Graphing/visualization:** When agents need to:
  - Render architecture or data flow diagrams for reports (e.g. ClawPay rails, PayClaw pipelines).
  - Visualize complex workflows for docs in `docs/` or status reports.

Treat these as **debugging/visualization patterns** that can be adapted to the existing agent framework.

### Symbol indexing pattern (jCodeMunch / MCP)

- **Recommended repo id:** `obra-superpowers`
- **Root to index:** path where you cloned `superpowers` (e.g. `~/.openclaw/workspace/skills/superpowers`)
- **Steps:**
  - Run `index_repo` on the repo root with:
    - `repo_id`: `"obra-superpowers"`
    - `root_dir`: cloned repo path
    - `include_globs`: `["**/*.py", "**/*.ts", "**/*.js", "**/*.md"]`
  - For large debugging flows, prefer `search_symbols` and `get_symbol` against `obra-superpowers` rather than raw text search.

---

## 3. Planning With Files (`OthmanAdi/planning-with-files`)

- **Repo:** `https://github.com/OthmanAdi/planning-with-files`
- **Purpose:** Persistent planning context / session catch‑up:
  - Reads a set of files + notes.
  - Produces a structured summary + next steps so an agent can quickly resume a large task.

### Install snippet

```bash
git clone https://github.com/OthmanAdi/planning-with-files.git
cd planning-with-files
cp -r skills/planning-with-files ~/.openclaw/workspace/skills/
```

### When to use for `claw-architect`

- **Multi-day refactors and campaigns:**
  - PayClaw macOS modernization.
  - ClawPay rail design and bot‑to‑bot payment flows.
  - CookiesPass / TempeCookiesPass / nirvaan/CookiesPass 3‑day campaigns.
- **Session catch‑up for complex missions:**
  - Any time an agent needs to re-enter a large codebase task after hours or days.

Agents should treat this as the **default planning skill** when work spans multiple sessions and repos.

### Symbol indexing pattern (jCodeMunch / MCP)

- **Recommended repo id:** `planning-with-files`
- **Root to index:** cloned `planning-with-files` repo (e.g. `~/.openclaw/workspace/skills/planning-with-files`)
- **Indexing focus:**
  - `skills/planning-with-files/**`
  - `scripts/session-catchup.py`
  - Any `README` / docs under `skills/`
- **Steps:**
  - Call `index_repo` with:
    - `repo_id`: `"planning-with-files"`
    - `root_dir`: cloned repo path
    - `include_globs`: `["**/*.py", "**/*.md", "skills/**/*.yaml", "skills/**/*.yml"]`
  - Downstream agents should use `get_symbol` on the planning runner and helpers instead of re-parsing the whole repo.

#### Future integration TODO

- Wrap `skills/planning-with-files/scripts/session-catchup.py` as a callable planning skill for the main architect agents (e.g. via a Trigger.dev task or an OpenClaw workspace skill wrapper), so missions like `cookiespass_v1_demo` can automatically trigger catch‑up summaries.

---

## 4. Skill Prompt Generator (`huangserva/skill-prompt-generator`)

- **Repo:** `https://github.com/huangserva/skill-prompt-generator`
- **Purpose:** Meta‑skill for **designing other skills**:
  - Generates structured prompts and skill definitions from YAML/frameworks.
  - Includes prompt analysis helpers like `prompt-extractor` and `prompt-xray`.

### Install snippet

```bash
git clone https://github.com/huangserva/skill-prompt-generator.git
cd skill-prompt-generator
cp -r .claude/skills/* ~/.openclaw/workspace/skills/
```

(You can also run its Python tooling directly if needed.)

### When to use for `claw-architect`

- **Internal skill factory:**
  - When agents need to design new OpenClaw/ClawPay/PayClaw‑related skills with consistent structure.
- **Prompt audit:**
  - When evaluating existing SKILL.md + script pairs for:
    - Prompt leakage.
    - Inconsistent instructions.
    - Opportunities to factor out reusable patterns.

Use this repo as a **design aid**, not something to vendor wholesale—pull in the specific helpers you need.

### Symbol indexing pattern (jCodeMunch / MCP)

- **Recommended repo id:** `skill-prompt-generator`
- **Root to index:** cloned `skill-prompt-generator` repo (e.g. `~/.openclaw/workspace/skills/skill-prompt-generator`)
- **Indexing focus:**
  - `.claude/skills/**`
  - Any `prompt-*` helpers or YAML definitions
  - Core Python or TypeScript sources (if present)
- **Steps:**
  - Run `index_repo` with:
    - `repo_id`: `"skill-prompt-generator"`
    - `root_dir`: cloned repo path
    - `include_globs`: `["**/*.py", "**/*.ts", "**/*.js", "**/*.md", ".claude/skills/**/*.md"]`
  - When designing new skills, agents should:
    - Use `search_symbols` on `skill-prompt-generator` to locate template generators.
    - Use `get_symbol` / `get_symbols` with small `context_lines` to pull only the needed helpers into their working memory.

---

## 5. Awesome Claude Code Subagents (`VoltAgent/awesome-claude-code-subagents`)

- **Repo:** `https://github.com/VoltAgent/awesome-claude-code-subagents`
- **Purpose:** Catalog (~140) of specialized subagent roles and workflows, organized by industry and best practice.
- **Note:** The value here is mostly in the **catalog and READMEs**, not in code.

### Install / usage

```bash
git clone https://github.com/VoltAgent/awesome-claude-code-subagents.git
cd awesome-claude-code-subagents
# Browse categories and subagent READMEs; cherry-pick patterns into agent-team config.
```

### When to use for `claw-architect`

- **Agent team design:**
  - When expanding `config/agent-team.json` or designing new mission agents.
  - When you want domain‑specific roles (e.g. SRE, security, finance) modeled on existing best practices.

Agents should reference this repo as a **role catalog** when deciding which new agents to introduce into the swarm, not as a dependency.

### Symbol indexing pattern (jCodeMunch / MCP)

Because this repo is primarily a **catalog of READMEs and role definitions**, treat the index as documentation-first:

- **Recommended repo id:** `awesome-claude-code-subagents`
- **Root to index:** cloned repo path (e.g. `~/.openclaw/workspace/skills/awesome-claude-code-subagents`)
- **Indexing focus:** `**/*.md`, `**/*.json`, any example `*.ts` / `*.py` files.
- **Steps:**
  - Use `index_repo` with:
    - `repo_id`: `"awesome-claude-code-subagents"`
    - `root_dir`: cloned repo path
    - `include_globs`: `["**/*.md", "**/*.json", "**/*.ts", "**/*.py"]`
  - When expanding `config/agent-team.json`, agents should:
    - Use `search_text` / `search_symbols` on this repo id to find relevant role archetypes.
    - Pull in just the snippets they need, not entire files.

---

## Future integrations (design stubs)

The repos above are intentionally not tightly coupled to `claw-architect`. Future agents should consider:

- **Planning With Files:**
  - Implement a small wrapper around `session-catchup.py` that:
    - Runs against selected mission folders (e.g. CookiesPass, PayClaw, ClawPay).
    - Emits a structured JSON summary stored under `agent-state/` for quick resumption.
  - Surface this as a callable planning skill in the main architect/foreman agent toolset.

- **Anthropic docx/pdf tools:**
  - Expose the DOCX/PDF scripts from `anthropics/skills` behind:
    - A small internal CLI (e.g. `npm run docs:audit`) or
    - A Trigger.dev / background task that:
      - Accepts report/doc paths.
      - Runs validations or transformations.
      - Persists results to `reports/` or `agent-state/`.

These are **TODOs**, not required for current missions, but kept here so they are MCP‑locatable and easy to pick up later.


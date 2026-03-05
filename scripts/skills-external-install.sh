#!/usr/bin/env bash
# Clone the five external skill repos for OpenClaw (index + use).
# After running, index each path with jCodeMunch: run scripts/mcp-index-everything.sh
# and call index_folder for each path, or use: npm run skills:index
# See docs/EXTERNAL-SKILLS-OPENCLAW.md and docs/MCP-INDEX-TARGETS.md.
set -euo pipefail

SKILLS_DIR="${OPENCLAW_WORKSPACE_SKILLS:-$HOME/.openclaw/workspace/skills}"
mkdir -p "$SKILLS_DIR"
cd "$SKILLS_DIR"

clone_or_pull() {
  local url="$1"
  local name="$2"
  if [[ -d "$name" ]]; then
    echo "Pull $name..."
    (cd "$name" && git pull --rebase --autostash || true)
  else
    echo "Clone $name..."
    git clone --depth 1 "$url" "$name"
  fi
}

# 1) Anthropic skills
clone_or_pull "https://github.com/anthropics/skills.git" "skills-anthropics"
# Copy skill contents into workspace for tools that expect flat skills/
if [[ -d "skills-anthropics/skills" ]]; then
  mkdir -p skills
  cp -rn skills-anthropics/skills/* skills/ 2>/dev/null || true
fi

# 2) Superpowers (SWE lifecycle / debugging)
clone_or_pull "https://github.com/obra/superpowers.git" "superpowers"
if [[ -d "superpowers/skills" ]]; then
  cp -rn superpowers/skills/* skills/ 2>/dev/null || true
fi

# 3) Planning with files (persistent context / session catch-up)
clone_or_pull "https://github.com/OthmanAdi/planning-with-files.git" "planning-with-files"
if [[ -d "planning-with-files/skills/planning-with-files" ]]; then
  mkdir -p skills/planning-with-files
  cp -rn planning-with-files/skills/planning-with-files/* skills/planning-with-files/ 2>/dev/null || true
fi

# 4) Skill prompt generator (meta-skill for designing skills)
clone_or_pull "https://github.com/huangserva/skill-prompt-generator.git" "skill-prompt-generator"
if [[ -d "skill-prompt-generator/.claude/skills" ]]; then
  cp -rn skill-prompt-generator/.claude/skills/* skills/ 2>/dev/null || true
fi

# 5) Awesome Claude Code Subagents (catalog of 140+ roles)
clone_or_pull "https://github.com/VoltAgent/awesome-claude-code-subagents.git" "awesome-claude-code-subagents"

echo "Done. Skills root: $SKILLS_DIR"
echo "Index next: run mcp-index-everything.sh and call jCodeMunch index_folder for each path above."

#!/usr/bin/env bash
# Print canonical paths for jCodeMunch MCP index_folder so agents "symbol index everything".
# Usage: ./scripts/mcp-index-everything.sh
#   Each line is a path; use with MCP tool index_folder: { "path": "<line>" }.
# Optional: CLAW_REPOS=/path/to/claw-repos (default: $HOME/claw-repos)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOS="${CLAW_REPOS:-$HOME/claw-repos}"

echo "$ROOT_DIR"

# Priority and product repos
for name in InayanBuilderBot CookiesPass cookies-tempe TempeCookiesPass payclaw autopay_ui CaptureInbound v0-skyn-patch capture infinitedata Inbound-cookies LeadGen3 quantfusion booked gbusupdate veritap veritap_2026; do
  [[ -d "$REPOS/$name" ]] && echo "$REPOS/$name"
done

# Additional claw-repos (skip _benchmarks, _oss_refs, dot/temp clones)
for name in 3DGameArtAcademy BlackWallStreetopoly Coinstbl FoodTruckPass HowtoWatchStream-SmartKB Madirectory mytutor patentpal PdfEzFill SmartKB SocialAiPilot SomaveaChaser syrup-internal-line-sheet tap2 wmactealth wmactealth-lc BakTokingcom RobloxGitSync nirvaan Cookies_Pass glitch-app LeadGenAi v0-morningops reframed oss-index oss-saas-bench usipeorg; do
  [[ -d "$REPOS/$name" ]] && echo "$REPOS/$name"
done

# External skills (when installed) — index each for fast symbol search; see docs/EXTERNAL-SKILLS-OPENCLAW.md
SKILLS_DIR="${OPENCLAW_WORKSPACE_SKILLS:-$HOME/.openclaw/workspace/skills}"
if [[ -d "$SKILLS_DIR" ]]; then
  for dir in "$SKILLS_DIR"/*; do
    [[ -d "$dir" ]] && echo "$dir"
  done
fi

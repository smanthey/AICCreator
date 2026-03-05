#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/tatsheen/claw-architect"
OSS_ROOT="/Users/tatsheen/claw-repos/oss-index/roblox"
PUZZLE_ROOT="/Users/tatsheen/claw-repos/oss-index/puzzle-bench"
REPORT_DIR="$ROOT/reports"
REPOMAP_DIR="$REPORT_DIR/repomaps"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
SEED_REPORT="$REPORT_DIR/roblox-oss-monetization-seeds-$STAMP.md"
LATEST_REPORT="$REPORT_DIR/roblox-oss-monetization-seeds-latest.md"

mkdir -p "$OSS_ROOT" "$PUZZLE_ROOT" "$REPOMAP_DIR" "$REPORT_DIR"

REPOS=(
  "https://github.com/Roblox/creator-docs.git"
  "https://github.com/Sleitnick/Knit.git"
  "https://github.com/Sleitnick/AeroGameFramework.git"
  "https://github.com/Quenty/NevermoreEngine.git"
  "https://github.com/evaera/roblox-lua-promise.git"
  "https://github.com/buildthomas/MockDataStoreService.git"
  "https://github.com/dphfox/Fusion.git"
  "https://github.com/roblox-aurora/rbx-net.git"
  "https://github.com/ffrostfall/ByteNet.git"
  "https://github.com/MonzterDev/Roblox-Game-Template.git"
  "https://github.com/synzahrh/knit-starter.git"
  "https://github.com/Roblox/roact.git"
  "https://github.com/Roblox/rodux.git"
  "https://github.com/Roblox/roact-rodux.git"
  "https://github.com/littensy/reflex.git"
  "https://github.com/evaera/matter.git"
  "https://github.com/Ukendio/jecs.git"
  "https://github.com/1ForeverHD/TopbarPlus.git"
  "https://github.com/1ForeverHD/ZonePlus.git"
  "https://github.com/osyrisrblx/t.git"
  "https://github.com/SirMallard/Iris.git"
  "https://github.com/jaipack17/Nature2D.git"
)

echo "[roblox-oss] syncing repositories into $OSS_ROOT"
cd "$OSS_ROOT"
for repo in "${REPOS[@]}"; do
  name="$(basename "$repo" .git)"
  if [[ -d "$name/.git" ]]; then
    git -C "$name" pull --ff-only --quiet || true
    echo "UPDATED $name"
  else
    if git clone --depth=1 "$repo" "$name" >/dev/null 2>&1; then
      echo "CLONED $name"
    else
      echo "FAILED $name"
    fi
  fi
done

PUZZLE_REPOS=(
  "https://github.com/puyoai/puyoai.git"
  "https://github.com/nullpomino/nullpomino.git"
)

echo "[roblox-oss] syncing gameplay benchmark repos into $PUZZLE_ROOT"
cd "$PUZZLE_ROOT"
for repo in "${PUZZLE_REPOS[@]}"; do
  name="$(basename "$repo" .git)"
  if [[ -d "$name/.git" ]]; then
    git -C "$name" pull --ff-only --quiet || true
    echo "UPDATED $name"
  else
    if git clone --depth=1 "$repo" "$name" >/dev/null 2>&1; then
      echo "CLONED $name"
    else
      echo "FAILED $name"
    fi
  fi
done

echo "[roblox-oss] generating repo maps"
for dir in "$OSS_ROOT"/* "$PUZZLE_ROOT"/*; do
  [[ -d "$dir/.git" ]] || continue
  repo_name="$(basename "$dir")"
  node "$ROOT/scripts/repo-map.js" "$dir" "$REPOMAP_DIR/roblox-$repo_name-repomap.md" >/dev/null || true
  echo "REPOMAP $repo_name"
done

{
  echo "# Roblox OSS Monetization + Setup Seeds"
  echo
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## Repo list"
  for dir in "$OSS_ROOT"/* "$PUZZLE_ROOT"/*; do
    [[ -d "$dir/.git" ]] || continue
    echo "- $(basename "$dir")"
  done
  echo
  echo "## Monetization and economy keyword hits"
  echo
  for dir in "$OSS_ROOT"/* "$PUZZLE_ROOT"/*; do
    [[ -d "$dir/.git" ]] || continue
    repo_name="$(basename "$dir")"
    echo "### $repo_name"
    hits="$(rg -n -i --glob '!**/.git/**' --glob '!**/node_modules/**' \
      'MarketplaceService|PromptProductPurchase|PromptGamePassPurchase|ProcessReceipt|DeveloperProduct|GamePass|BattlePass|VIP|Quest|DailyReward|DataStore|Economy|Currency' \
      "$dir" | head -n 25 || true)"
    if [[ -n "$hits" ]]; then
      echo '```text'
      echo "$hits"
      echo '```'
    else
      echo "No keyword hits in first-pass scan."
    fi
    echo
  done
} > "$SEED_REPORT"

cp "$SEED_REPORT" "$LATEST_REPORT"

echo "[roblox-oss] wrote report: $SEED_REPORT"
echo "[roblox-oss] wrote latest: $LATEST_REPORT"

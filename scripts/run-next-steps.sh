#!/bin/bash
# run-next-steps.sh
# Run from Mac terminal in ~/claw-architect after the brand expansion session.
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════════════"
echo " ClawdBot — Brand Expansion Post-Processing"
echo "═══════════════════════════════════════════════════════"

# ── Step 1: Push git commit ──────────────────────────────────────────────────
echo ""
echo "📤 Step 1: Push to GitHub..."
git push origin main
echo "   ✅ Pushed"

# ── Step 2: Apply migration 019 (brand backfill) ────────────────────────────
echo ""
echo "🔧 Step 2: Check / apply migration 019 brand backfill..."
node scripts/check-brand-coverage.js --apply
echo "   ✅ Done"

# ── Step 3: Re-run dedup with brand-aware grouping ──────────────────────────
echo ""
echo "🔍 Step 3: Re-running duplicate detection (brand-aware)..."
node scripts/run-dedup.js --clear
echo "   ✅ Dedup complete"

# ── Step 4: Final brand coverage report ─────────────────────────────────────
echo ""
echo "📊 Step 4: Final brand + coverage report..."
node scripts/check-brand-coverage.js --top

echo ""
echo "═══════════════════════════════════════════════════════"
echo " All done! Next: GitHub repo indexer (Phase 2)"
echo "═══════════════════════════════════════════════════════"

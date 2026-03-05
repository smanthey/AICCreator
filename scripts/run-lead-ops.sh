#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[lead-ops] email enrichment"
node scripts/email-finder.js --limit "${1:-120}"

echo "[lead-ops] scrape"
node scripts/google-maps-scraper.js --query "health food store" --city "Scottsdale, AZ" --limit 30
node scripts/google-maps-scraper.js --query "health food store" --city "Tempe, AZ" --limit 30
node scripts/google-maps-scraper.js --query "gym supplement store" --city "Phoenix, AZ" --limit 30

echo "[lead-ops] send"
node scripts/daily-send-scheduler.js --max-sends 25

echo "[lead-ops] status"
node scripts/lead-pipeline.js --status


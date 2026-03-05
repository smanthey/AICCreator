#!/bin/bash
# start-all-persistent.sh
# Ensures all systems start under PM2 for persistence

set -e

echo "🚀 Starting all systems under PM2 for persistence..."
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed!"
    echo "Install with: npm install -g pm2"
    exit 1
fi

# Start background services
echo "📦 Starting background services..."
pm2 start ecosystem.background.config.js || true

# Start control plane
echo "🎮 Starting control plane..."
pm2 start ecosystem.config.js || true

# Save process list
echo "💾 Saving PM2 process list..."
pm2 save

echo ""
echo "✅ All systems started under PM2!"
echo ""
echo "Check status:"
echo "  pm2 status"
echo ""
echo "View logs:"
echo "  pm2 logs"
echo ""
echo "Verify persistence:"
echo "  Close all terminals, open a new one, run: pm2 status"
echo ""

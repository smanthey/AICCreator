#!/usr/bin/env bash
# infra/redis-setup.sh
# One-time Redis hardening for BullMQ (production).
#
# BullMQ requires:
#   - maxmemory-policy noeviction — if Redis evicts keys under memory pressure,
#     queued jobs silently disappear.
#   - AOF (Append Only File) — durability; jobs survive Redis restart.
#
# Run this ONCE on the machine where Redis is running (or via REDIS_HOST/REDIS_PORT):
#   bash infra/redis-setup.sh
#
# Or run from any machine:
#   REDIS_HOST=192.168.1.164 REDIS_PORT=16379 bash infra/redis-setup.sh

REDIS_HOST="${REDIS_HOST:-192.168.1.164}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_CMD="redis-cli -h $REDIS_HOST -p $REDIS_PORT"

echo "Connecting to Redis at $REDIS_HOST:$REDIS_PORT..."

# 1. Set noeviction policy (BullMQ requirement)
$REDIS_CMD CONFIG SET maxmemory-policy noeviction
if [ $? -ne 0 ]; then
  echo "ERROR: Could not connect to Redis. Make sure Redis is running at $REDIS_HOST:$REDIS_PORT"
  exit 1
fi

# 2. Enable AOF for durability
$REDIS_CMD CONFIG SET appendonly yes
$REDIS_CMD CONFIG SET appendfsync everysec

# Verify noeviction
POLICY=$($REDIS_CMD CONFIG GET maxmemory-policy | tail -1)
echo "maxmemory-policy is now: $POLICY"

if [ "$POLICY" != "noeviction" ]; then
  echo "WARNING: Policy was not set correctly. Got: $POLICY"
  exit 1
fi

AOF=$($REDIS_CMD CONFIG GET appendonly | tail -1)
echo "appendonly is now: $AOF"

echo ""
echo "✅ Redis hardening complete"
echo ""
echo "To persist across restarts, add to redis.conf:"
echo "  maxmemory-policy noeviction"
echo "  appendonly yes"
echo "  appendfsync everysec"
echo ""
echo "C1 (auth): add requirepass YOUR_STRONG_PASSWORD and set REDIS_PASSWORD in .env."
echo "  See infra/nas-auth-hardening.md for full NAS Redis + Postgres runbook."

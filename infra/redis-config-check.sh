#!/usr/bin/env bash
# Optional: Warn if Redis config is unsuitable for BullMQ.
# Run before starting workers or from cron. Exit 0 = OK, 1 = config issue.
#
# Usage: REDIS_HOST=192.168.1.164 REDIS_PORT=16379 bash infra/redis-config-check.sh

REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_TIMEOUT="${REDIS_TIMEOUT:-5}"
REDIS_CMD="redis-cli -h $REDIS_HOST -p $REDIS_PORT -t $REDIS_TIMEOUT"

if ! command -v redis-cli &>/dev/null; then
  echo "WARN: redis-cli not found — skipping Redis config check"
  exit 0
fi

POLICY=$($REDIS_CMD CONFIG GET maxmemory-policy 2>/dev/null | tail -1)
AOF=$($REDIS_CMD CONFIG GET appendonly 2>/dev/null | tail -1)

if [ -z "$POLICY" ]; then
  echo "WARN: Could not connect to Redis at $REDIS_HOST:$REDIS_PORT"
  exit 1
fi

ERR=0
if [ "$POLICY" != "noeviction" ]; then
  echo "WARN: Redis maxmemory-policy is '$POLICY'; BullMQ requires noeviction. Run infra/redis-setup.sh"
  ERR=1
fi
if [ "$AOF" != "yes" ]; then
  echo "WARN: Redis appendonly is '$AOF'; recommended 'yes' for durability. Run infra/redis-setup.sh"
  ERR=1
fi

if [ $ERR -eq 0 ]; then
  echo "Redis config OK (noeviction, appendonly=$AOF)"
fi
exit $ERR

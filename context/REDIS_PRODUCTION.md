# Redis Production Hardening (BullMQ)

> NAS Redis must use these settings for BullMQ reliability. Run `infra/redis-setup.sh` once.

## Required Settings

| Setting | Value | Reason |
|---------|-------|--------|
| `maxmemory-policy` | `noeviction` | BullMQ queue keys must never be evicted; eviction causes silent job loss |
| `appendonly` | `yes` | Durability; jobs survive Redis restart |
| `appendfsync` | `everysec` | Balance of durability and performance |

## Setup

```bash
REDIS_HOST=192.168.1.164 REDIS_PORT=16379 bash infra/redis-setup.sh
```

## Verify

```bash
redis-cli -h $REDIS_HOST -p $REDIS_PORT CONFIG GET maxmemory-policy
redis-cli -h $REDIS_HOST -p $REDIS_PORT CONFIG GET appendonly
```

## Optional: Startup check

To warn if Redis config is unsuitable before starting workers:

```bash
REDIS_HOST=192.168.1.164 REDIS_PORT=16379 bash infra/redis-config-check.sh
```

Exit 0 = OK; exit 1 = policy or AOF wrong (run `redis-setup.sh`).

## Persist in redis.conf

Add to `/etc/redis/redis.conf` (or your Redis config path) so settings survive restart:

```
maxmemory-policy noeviction
appendonly yes
appendfsync everysec
```

## C1: Require password (no unauthenticated access on LAN)

Add to the same `redis.conf` (use a strong password; set `REDIS_PASSWORD` in `.env` on all clients):

```
requirepass YOUR_STRONG_REDIS_PASSWORD
```

Restart Redis after changing. See **infra/nas-auth-hardening.md** for full NAS runbook (Redis + Postgres).

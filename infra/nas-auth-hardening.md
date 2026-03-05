# NAS Auth Hardening (C1/C2)

Runbook to fix **Redis no-auth** and **PostgreSQL trust auth** on the NAS. Apply these on the host where Redis and Postgres run (e.g. Synology / Linux NAS at `192.168.1.164`).

## C1: Redis — add requirepass

1. **Choose a strong password** and set it in `.env` as `REDIS_PASSWORD` (all workers and scripts must use it).
2. **On the NAS**, edit Redis config. Common paths:
   - Linux: `/etc/redis/redis.conf`
   - Synology: `/var/packages/redis/etc/redis.conf` or similar (check Package Center → Redis → Info).
3. **Add or uncomment** (use a strong value, not this example):

   ```conf
   # Redis password (C1 remediation — no unauthenticated access on LAN)
   requirepass YOUR_STRONG_REDIS_PASSWORD
   ```

4. **Persist other BullMQ-safe settings** in the same file if not already present:

   ```conf
   maxmemory-policy noeviction
   appendonly yes
   appendfsync everysec
   ```

5. **Restart Redis** so the config is loaded.
6. **Verify:**  
   `redis-cli -h 192.168.1.164 -p 16379 AUTH YOUR_STRONG_REDIS_PASSWORD`  
   then `PING` → `PONG`. Without `AUTH`, commands should fail.
7. **Set `REDIS_PASSWORD`** in `.env` on every machine that connects to Redis (workers, architect-api, scripts).

---

## C2: PostgreSQL — scram-sha-256 in pg_hba.conf

1. **Ensure DB users have passwords** (e.g. `claw`). If using trust, set a password:

   ```bash
   psql -h localhost -p 15432 -U postgres -d claw_architect -c "ALTER USER claw PASSWORD 'strong_password';"
   ```

2. **Locate pg_hba.conf** on the NAS. Typical paths:
   - Linux: `/etc/postgresql/<ver>/main/pg_hba.conf` or `/var/lib/postgresql/data/pg_hba.conf`
   - Synology: Package Center → PostgreSQL → volume path, or `/var/packages/PostgreSQL/etc/pg_hba.conf`.
3. **Replace `trust` with `scram-sha-256`** for the relevant lines. Example — change lines like:

   ```conf
   host    all    all    0.0.0.0/0    trust
   host    all    all    ::/0         trust
   ```

   to (restrict subnets if possible):

   ```conf
   host    all    all    192.168.1.0/24    scram-sha-256
   host    all    all    ::/0               scram-sha-256
   ```

   Use your LAN subnet instead of `0.0.0.0/0` if all clients are on one network.

4. **Reload Postgres** (no restart needed):  
   `psql -U postgres -c "SELECT pg_reload_conf();"`  
   or restart the PostgreSQL service.
5. **Verify:** From a client machine, connect with password:  
   `psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -W`  
   Connection must require the password; `trust` should no longer allow passwordless access.
6. **Set `POSTGRES_PASSWORD` / `CLAW_DB_PASSWORD`** in `.env` everywhere that connects to the NAS DB.

---

## Summary

| Item | Where | What |
|------|--------|------|
| C1 Redis | `redis.conf` on NAS | Add `requirepass <strong_password>`; set `REDIS_PASSWORD` in .env |
| C2 Postgres | `pg_hba.conf` on NAS | Replace `trust` with `scram-sha-256`; set user passwords and `POSTGRES_PASSWORD` in .env |

After both are applied, run a quick sanity check: worker start, architect-api health, and `node scripts/run-migrations.js --status`.

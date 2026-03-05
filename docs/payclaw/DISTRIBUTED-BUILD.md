# PayClaw Distributed Build — All Machines Contribute, Push to Git

**Goal:** Distribute the PayClaw Mac OS build across NAS, i7 desktop, and AI satellite so workers on each machine pick up tasks from the shared queue, do their chunk, and push to the PayClaw repo. Faster parallel progress.

---

## 1. Architecture

| Machine | Workers | Tags | Queues |
|---------|---------|------|--------|
| **NAS** (192.168.1.164) | claw-worker-nas (×3), claw-worker-ai (×4) | infra, io_heavy, ai, qa | claw_tasks_io_heavy, claw_tasks_ai |
| **i7 desktop** | i7-desktop-worker-nas, i7-desktop-worker-io | infra, io_heavy | claw_tasks_io_heavy |
| **AI satellite** | claw-ai-satellite-worker-ai | ai, qa | claw_tasks_ai |

All workers share the same **Redis** (192.168.1.164:16379) and **PostgreSQL** (192.168.1.164). Tasks are queued once; whichever machine has an idle worker with matching tags picks them up.

---

## 2. Prerequisites (each machine)

1. **Claw-architect repo** cloned and `npm install` done.
2. **`.env`** with shared targets:
   - `REDIS_HOST=192.168.1.164`
   - `REDIS_PORT=16379`
   - `POSTGRES_HOST=192.168.1.164` (if different from default)
3. **PayClaw repo** at `~/claw-repos/payclaw` (or `$REPOS_BASE_PATH/payclaw`). Run `npm run payclaw:launch` once from the control plane to seed it.
4. **Autopay_ui** at `~/claw-repos/autopay_ui` (source to copy from).

---

## 3. Start workers on each machine

```bash
# NAS (or main control plane)
pm2 start ecosystem.background.config.js

# i7 desktop (clone claw-architect, set .env, then)
pm2 start ecosystem.i7-satellite.config.js

# AI satellite (M1 laptop, etc.)
SATELLITE_NAME=claw-ai-satellite pm2 start ecosystem.ai-satellite.config.js
```

Ensure each satellite's ecosystem env includes `REDIS_HOST` (see §5).

---

## 4. Dispatch PayClaw build chunks

From anywhere with DB/Redis access:

```bash
npm run payclaw:dispatch:chunks
```

This queues multiple tasks; workers on NAS, i7, and AI satellite will pick them up:

- **repo_autofix** (io_heavy): NAS + i7 — port SMS, Stripe, API routes, compliance
- **opencode_controller** (ai): NAS + AI satellite — Mac shell scaffold, dashboard polish

Each task works on the PayClaw repo, creates/updates a branch, commits, and pushes. Merge branches manually or via a follow-up merge task.

---

## 5. Satellite config (REDIS_HOST)

For i7 and AI satellites to join the pool, add to their ecosystem env:

```js
env: {
  REDIS_HOST: "192.168.1.164",
  REDIS_PORT: "16379",
  // ... rest
}
```

Or set in `.env` on each satellite machine.

---

## 6. Git workflow

- Each chunk uses branch `payclaw/wip-{chunk}-{shortId}` to avoid conflicts.
- Chunks are designed to touch different areas: SMS, Stripe, API, dashboard, Mac shell, compliance.
- After chunks complete, merge branches into `main` (manually or via PR).
- Re-run `npm run payclaw:launch` to sync latest compliance into PayClaw before merging.

---

## 7. Quick verify

```bash
# See which workers are online
pm2 jlist | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const workers = d.filter(p=>p.name && (p.name.includes('worker') || p.name.includes('Worker')));
console.table(workers.map(p=>({name:p.name, status:p.pm2_env?.status, host: p.pm2_env?.pm_cwd?.slice(0,30)})));
"

# Queue health
npm run tasks:health
```

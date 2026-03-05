# Self-Aware + Self-Modifying System (PR-Only)

This system adds a controlled self-modification loop for `claw-architect`:

1. Build a live self-awareness index of code, docs, runtime, models, and harnesses.
2. Accept behavior-change requests as queue items.
3. Process requests in a worker that runs a PR-only autonomous cycle.
4. Open draft PRs for review (never deploy directly).

## Commands

- `npm run self:aware:index`
  - Writes:
    - `artifacts/self-awareness/latest.json`
    - `artifacts/self-awareness/latest.md`

- `npm run self:mod:request -- --title "..." --request "..." --priority high`
  - Appends request to `artifacts/self-awareness/self-mod-queue.json`

- `npm run self:mod:worker -- --max 1`
  - Picks queued requests and runs PR cycle.
  - Writes execution history to `artifacts/self-awareness/self-mod-history.json`.

- `npm run autonomy:pr`
  - Branch + draft PR generation in isolated worktree.

## PM2 jobs

Configured in `ecosystem.background.config.js`:

- `claw-self-awareness-index` every 30 minutes
- `claw-self-mod-worker` hourly (minute 10)
- `claw-autonomy-pr-cycle` nightly 4:00 AM

## API endpoints (`ops-api`)

- `GET /api/self-awareness`
  - Returns latest index and queue snapshot.

- `POST /api/self-mod/request`
  - JSON body:
    - `title` (required)
    - `request` (required)
    - `priority` (`high|medium|low`, optional)

## Safety model

- PR-only changes.
- No direct production deploy from self-mod scripts.
- Human review + merge required.

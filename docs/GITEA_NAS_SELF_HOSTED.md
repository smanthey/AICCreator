# Self-Hosted Git Server on NAS (Gitea)

This gives your agents a private Git remote you control, so automation can continue if GitHub access is limited.

## What this setup provides

- Local Git server (`Gitea`) on NAS
- Agent push/pull over SSH
- Multi-agent collaboration via org/team + branch protections
- Local backup/restore scripts for Git server state

## 0) Prerequisites (NAS)

- Docker + Docker Compose plugin installed on NAS
- NAS reachable on LAN (example `192.168.1.164`)
- Ports open on LAN:
  - `3000` (Gitea web)
  - `2222` (Gitea SSH git)

Files added:

- `infra/gitea/docker-compose.gitea.yml`
- `scripts/gitea-nas-bootstrap.sh`
- `scripts/gitea-create-agent-key.sh`
- `scripts/gitea-configure-remote.sh`
- `scripts/gitea-nas-backup.sh`
- `scripts/gitea-nas-restore.sh`

## 1) Start Gitea on NAS

From this repo:

```bash
cd /Users/tatsheen/claw-architect
npm run gitea:nas:bootstrap
```

This launches Gitea and prints the URL.
Default:

- Web: `http://192.168.1.164:3000`
- SSH: `ssh://git@192.168.1.164:2222/<owner>/<repo>.git`

## 2) First-time Gitea admin setup

Open web UI and do initial setup:

1. Create admin user.
2. Create organization `agents`.
3. Create team(s):
   - `agents-dev`
   - `agents-review`
   - `agents-ops`
4. Create repositories (or import from GitHub).

## 3) Configure repos for safe multi-agent collaboration

For each repo in Gitea:

1. Set default branch `main`.
2. Protect `main`:
   - block direct pushes
   - require PR/merge checks (if using CI)
3. Agent branch convention:
   - `agent/<role>/<task>`
   - example: `agent/debugger/fix-webhook-replay`

This prevents agent collisions and keeps history clean.

## 4) Agent SSH keys (per device/agent identity)

On each device/agent runtime, create a dedicated key:

```bash
cd /Users/tatsheen/claw-architect
npm run gitea:agent:key -- m3max-ai
npm run gitea:agent:key -- m1-laptop-ai
npm run gitea:agent:key -- m1-desktop-ai
npm run gitea:agent:key -- i7-desktop-ai
```

Add each generated `.pub` key in Gitea:

- User Settings -> SSH / GPG Keys -> Add Key

Recommended policy:

- One service account per agent class (`agent-ai`, `agent-ops`) OR one key per machine+agent.
- Revoke compromised keys without impacting others.

## 5) Point local repo to Gitea remote

Inside each git repo you want agents to push:

```bash
cd /path/to/repo
GITEA_HOST=192.168.1.164 GITEA_SSH_PORT=2222 AGENT_KEY_PATH=$HOME/.ssh/id_ed25519_m3max-ai_gitea \
  npm run --prefix /Users/tatsheen/claw-architect gitea:remote:configure -- agents claw-architect gitea
```

First push:

```bash
git push -u gitea HEAD
```

## 6) Collaboration model for 4-10 agents

- All agents pull from `main` before starting a task.
- Each agent works on its own branch.
- Push branch to Gitea.
- Open PR in Gitea UI.
- Review agent merges only after checks pass.

Suggested roles:

- `agent-saas-dev`
- `agent-debugger`
- `agent-code-review`
- `agent-docs`
- `agent-research`

## 7) Backup and restore

Backup Gitea state:

```bash
cd /Users/tatsheen/claw-architect
npm run gitea:nas:backup
```

Restore from backup tarball:

```bash
cd /Users/tatsheen/claw-architect
npm run gitea:nas:restore -- /volume1/backups/gitea/gitea-data-YYYYMMDD-HHMMSS.tar.gz
```

## 8) Optional: mirror from GitHub to Gitea

In each Gitea repo:

- Settings -> Mirror Settings -> Pull mirror from GitHub

or use local sync job in agent workflow:

- `git fetch origin`
- `git push gitea --all`
- `git push gitea --tags`

## 9) Security notes

- This removes platform-account suspension risk from your primary automation path.
- It does **not** remove all risk: protect NAS, LAN access, and SSH keys.
- Use HTTPS + reverse proxy + internal VPN if exposing outside local network.

## 10) Quick health checks

```bash
docker ps --filter name=gitea
curl -I http://192.168.1.164:3000
ssh -p 2222 git@192.168.1.164
```

Expected:

- container `gitea` is `Up`
- HTTP 200/302 from web
- SSH connects (Git shell only)


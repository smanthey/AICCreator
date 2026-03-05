#!/bin/bash
# scripts/setup.sh
# Run on any new machine to join the Claw Architect worker pool.
# Usage: bash scripts/setup.sh

set -e

GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; BOLD="\033[1m"; RESET="\033[0m"

echo -e "${BOLD}╔══════════════════════════════════════╗"
echo -e "║   Claw Architect — Machine Setup     ║"
echo -e "╚══════════════════════════════════════╝${RESET}\n"

# 1. Check Node
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found. Install from https://nodejs.org${RESET}"; exit 1
fi
echo -e "${GREEN}✓ Node $(node --version)${RESET}"

# 2. Install dependencies
echo -e "\n${BOLD}Installing dependencies...${RESET}"
npm install --silent
echo -e "${GREEN}✓ npm install done${RESET}"

# 3. Create .env if missing
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "\n${YELLOW}⚠  .env created from .env.example"
  echo -e "   Fill in POSTGRES_PASSWORD and any required keys, then re-run.${RESET}"
  exit 0
fi

# 4. Prompt for WORKER_TAGS if not in .env
if ! grep -q "WORKER_TAGS" .env; then
  echo -e "\n${BOLD}What role is this machine?${RESET}"
  echo "  1) Control plane  (gateway + light worker)  →  io_light"
  echo "  2) M3/M4 LLM box  (Ollama)                  →  llm_local,io_light"
  echo "  3) Light worker   (M1, indexing)             →  io_light"
  echo "  4) Heavy IO       (NAS-adjacent)             →  io_heavy,io_light"
  echo "  5) QA node        (Playwright)               →  qa,io_light"
  read -p "Choose [1-5]: " CHOICE
  case $CHOICE in
    2) TAGS="llm_local,io_light" ;;
    4) TAGS="io_heavy,io_light"  ;;
    5) TAGS="qa,io_light"        ;;
    *) TAGS="io_light"           ;;
  esac
  echo -e "\nWORKER_TAGS=$TAGS" >> .env
  echo -e "${GREEN}✓ WORKER_TAGS=$TAGS written to .env${RESET}"
fi

# 5. Test connectivity
echo -e "\n${BOLD}Testing connections...${RESET}"

node -e "
require('dotenv').config();
const pg = require('./infra/postgres');
pg.query('SELECT 1')
  .then(() => { console.log('postgres ok'); process.exit(0); })
  .catch(e  => { console.error('postgres fail:', e.message); process.exit(1); });
" && echo -e "${GREEN}✓ Postgres${RESET}" || echo -e "${RED}✗ Postgres — check .env${RESET}"

node -e "
require('dotenv').config();
const r = require('./infra/redis');
r.ping()
  .then(() => { console.log('redis ok'); r.disconnect(); process.exit(0); })
  .catch(e  => { console.error('redis fail:', e.message); process.exit(1); });
" && echo -e "${GREEN}✓ Redis${RESET}" || echo -e "${RED}✗ Redis — check REDIS_HOST in .env${RESET}"

# 6. Done
echo -e "\n${BOLD}╔══════════════════════════════════════╗"
echo -e "║            Ready                     ║"
echo -e "╚══════════════════════════════════════╝${RESET}\n"
echo -e "Start worker:        ${YELLOW}node workers/worker.js${RESET}"
echo -e "Start with pm2:      ${YELLOW}npm i -g pm2 && pm2 start workers/worker.js --name claw-worker && pm2 save && pm2 startup${RESET}"
echo -e "Check metrics:       ${YELLOW}node cli/metrics.js${RESET}"
echo -e "Check dead letters:  ${YELLOW}node cli/dead-letters.js${RESET}"

#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
npm run openclawless:setup
npm run oss:dashboard:benchmark
npm run reddit:search
npm run youtube:index:auto

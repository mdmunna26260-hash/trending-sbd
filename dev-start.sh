#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f node_modules/next/dist/bin/next ]; then
  echo "[dev-start] installing locked dependencies..."
  npm ci
fi
# Never replace the generated client with demo/in-memory data. The documented
# dev setup uses the real SQLite schema (npm run db:push && npm run db:seed).
node scripts/bootstrap-dev.js
exec npm run dev

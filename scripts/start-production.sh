#!/usr/bin/env bash
# Production Next.js — no npm wrapper, no inherited NODE_OPTIONS inspect flags.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .next/BUILD_ID ]]; then
  echo "Missing .next/BUILD_ID — run: npm run build" >&2
  exit 1
fi

unset NODE_OPTIONS
export NODE_ENV=production
export PORT="${PORT:-3000}"

exec node node_modules/next/dist/bin/next start "$@"

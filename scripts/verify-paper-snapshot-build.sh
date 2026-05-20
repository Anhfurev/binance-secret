#!/usr/bin/env bash
# After npm run build — confirm old snapshot error strings are NOT in the server bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }
BAD=0
for needle in "snapshot insert failed" "total_nav_usdt"; do
  if rg -q "$needle" .next/server 2>/dev/null; then
    echo "FAIL: found '$needle' in .next/server — deploy would still spam errors"
    BAD=1
  fi
done
if [[ "$BAD" -eq 0 ]]; then
  echo "OK: paper snapshot bundle is v4-slim (no legacy error strings)"
fi
exit "$BAD"

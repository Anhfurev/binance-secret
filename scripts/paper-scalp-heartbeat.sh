#!/usr/bin/env bash
# Hourly paper-scalp cron — call once per hour (not every minute).
# Example crontab: 0 * * * * /path/to/binance/scripts/paper-scalp-heartbeat.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi
PORT="${PORT:-3000}"
SECRET="${CRON_SECRET:-}"
URL="http://127.0.0.1:${PORT}/api/automation/paper/run"
AUTH=()
if [[ -n "$SECRET" ]]; then AUTH=(-H "Authorization: Bearer ${SECRET}"); fi

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

# -m 15: allow Next.js dev hot-reload / compile (up to ~5s) without HTTP_STATUS:000
CURL_OPTS=(-sS -m 15 -w '%{http_code}' -o "$BODY_FILE")

if ! HTTP_STATUS="$(curl "${CURL_OPTS[@]}" "${AUTH[@]}" "$URL" 2>/dev/null)"; then
  HTTP_STATUS="000"
fi

echo "HTTP_STATUS:${HTTP_STATUS}"
cat "$BODY_FILE"
echo ""

if [[ "$HTTP_STATUS" =~ ^2 ]]; then
  exit 0
fi
exit 1

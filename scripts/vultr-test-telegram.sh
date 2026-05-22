#!/usr/bin/env bash
# Send one test Telegram via local binance-bot (after .env + PM2 fix).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] && set -a && source .env && set +a

BOT_URL="${BINANCE_BOT_WAKE_URL:-http://127.0.0.1:8788}"
SECRET="${BOT_SECRET:-}"
[[ -n "$SECRET" ]] || { echo "BOT_SECRET missing in .env"; exit 1; }

echo "POST ${BOT_URL} telegram_ping"
curl -sS -X POST "${BOT_URL%/}/" \
  -H "Content-Type: application/json" \
  -H "x-binance-bot-secret: ${SECRET}" \
  -d '{"telegram_ping":true}'

echo ""

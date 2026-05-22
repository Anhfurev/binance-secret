#!/usr/bin/env bash
# Match debugger MISSING_REQUIRED_ENV checks (health-debugger.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a

ok() { echo "OK   $1"; }
miss() { echo "MISS $1"; }

check() {
  local label="$1"
  shift
  for k in "$@"; do
    if [[ -n "${!k:-}" ]]; then ok "$label (via $k)"; return; fi
  done
  miss "$label (need one of: $*)"
}

check SUPABASE_URL SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL
check SUPABASE_SERVICE_ROLE_KEY SUPABASE_SERVICE_ROLE_KEY DB_SERVICE_ROLE_KEY
check BOT_SECRET BOT_SECRET BINANCE_BOT_SECRET
check BINANCE_API_KEY BINANCE_API_KEY
check BINANCE_SECRET BINANCE_SECRET BINANCE_API_SECRET
check TELEGRAM_BOT_TOKEN TELEGRAM_BOT_TOKEN
check TELEGRAM_CHAT_ID TELEGRAM_CHAT_ID TELEGRAM_BOT_CHAT_ID

if [[ -n "${GEMINI_API_KEY:-}" ]] || [[ -n "${GEMINI_KEYS_POOL:-}" ]]; then
  ok "GEMINI (key or pool)"
else
  miss "GEMINI_API_KEY or GEMINI_KEYS_POOL"
fi

echo ""
echo "Gateway: ${BINANCE_REST_GATEWAY_URL:-unset}"
echo "FAST_BOUNCE_FUTURES_LANE: ${FAST_BOUNCE_FUTURES_LANE:-auto}"

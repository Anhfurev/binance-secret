#!/usr/bin/env bash
# Quick VPS check — paper engine + Telegram (no secret values printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
fail=0

check_var() {
  local name="$1"
  if grep -q "^${name}=" "$ENV_FILE" 2>/dev/null; then
    echo "OK   $name"
  else
    echo "MISS $name"
    fail=1
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

echo "=== Required for paper + Telegram ($ENV_FILE) ==="
check_var NEXT_PUBLIC_SUPABASE_URL
check_var SUPABASE_SERVICE_ROLE_KEY
check_var PAPER_TRADES_USER_ID
check_var TELEGRAM_BOT_TOKEN
check_var TELEGRAM_CHAT_ID
check_var CRON_SECRET

echo ""
echo "=== Recommended ==="
grep -q '^PAPER_SCALP_WALLET_USD=' "$ENV_FILE" && echo "OK   PAPER_SCALP_WALLET_USD" || echo "hint PAPER_SCALP_WALLET_USD=28 (optional, default 28)"
grep -q '^PAPER_TELEGRAM_PULSE_EVERY_MS=' "$ENV_FILE" && echo "OK   PAPER_TELEGRAM_PULSE_EVERY_MS" || echo "hint PAPER_TELEGRAM_PULSE_EVERY_MS=1800000 (30m status pulse)"

echo ""
echo "Line count: $(wc -l < "$ENV_FILE") (if only ~5 lines, .env.local was overwritten — restore full file)"
exit "$fail"

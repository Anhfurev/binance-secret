#!/usr/bin/env bash
# Quick VPS checks when :8788 connection refused.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== PM2 ==="
pm2 status binance-bot 2>/dev/null || pm2 status

echo ""
echo "=== Port 8788 ==="
ss -tlnp | grep 8788 || echo "nothing listening on 8788"

echo ""
echo "=== Required .env keys (masked) ==="
[[ -f .env ]] || { echo "MISSING .env"; exit 1; }
set -a
# shellcheck disable=SC1091
source .env
set +a
for k in BOT_SECRET SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  v="${!k:-}"
  if [[ -n "$v" ]]; then echo "$k=set (${#v} chars)"; else echo "$k=MISSING"; fi
done
echo "SUPABASE_URL=${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"

echo ""
echo "=== PM2 logs (last 40 lines) ==="
pm2 logs binance-bot --lines 40 --nostream 2>/dev/null || true

echo ""
echo "=== Start log ==="
tail -30 /var/log/binance-bot-start.log 2>/dev/null || echo "no /var/log/binance-bot-start.log"

echo ""
echo "=== Manual start test (5s) ==="
timeout 8 bash scripts/vultr-deno-bot.sh &
sleep 6
ss -tlnp | grep 8788 || echo "still not listening after manual start"
kill %% 2>/dev/null || true

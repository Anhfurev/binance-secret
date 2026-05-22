#!/usr/bin/env bash
# Run on Vultr gateway every minute (crontab). Calls local Deno bot, not Supabase Edge.
# Example crontab (as root):
#   * * * * * /root/binance-bot/scripts/vultr-bot-cron.sh >> /var/log/vultr-bot-cron.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
elif [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi

BOT_URL="${BINANCE_BOT_WAKE_URL:-http://127.0.0.1:8788}"
BOT_SECRET="${BOT_WAKE_SECRET:-${BOT_SECRET:-}}"
SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-${SUPABASE_URL:-}}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${DB_SERVICE_ROLE_KEY:-}}"

if [[ -z "$BOT_SECRET" ]]; then
  echo "[vultr-bot-cron] skip — BOT_SECRET unset"
  exit 0
fi

SYMBOLS_JSON='["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","PEPEUSDT","DOGEUSDT","XRPUSDT","ADAUSDT","LINKUSDT","AVAXUSDT"]'

if [[ -n "$SUPABASE_URL" && -n "$SERVICE_KEY" ]]; then
  fetched="$(curl -sS --max-time 15 \
    "${SUPABASE_URL}/rest/v1/bot_settings?select=symbol&is_autopilot_enabled=eq.true&order=symbol.asc" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Accept: application/json" 2>/dev/null || true)"
  if [[ -n "$fetched" && "$fetched" != "[]" ]]; then
    SYMBOLS_JSON="$(printf '%s' "$fetched" | node -e "
      let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{
        try {
          const rows=JSON.parse(s);
          const syms=[...new Set(rows.map(r=>String(r.symbol||'').toUpperCase()).filter(Boolean))].sort();
          if (syms.length) console.log(JSON.stringify(syms));
        } catch { process.exit(1); }
      });
    " 2>/dev/null || true)"
  fi
fi

echo "[vultr-bot-cron] symbols=${SYMBOLS_JSON}"
curl -sS --max-time 180 -X POST "${BOT_URL%/}/" \
  -H "Content-Type: application/json" \
  -H "x-binance-bot-secret: ${BOT_SECRET}" \
  -d "{\"symbols\":${SYMBOLS_JSON},\"trigger\":\"vultr_cron\"}" \
  -w "\n[vultr-bot-cron] http=%{http_code} time=%{time_total}s\n"

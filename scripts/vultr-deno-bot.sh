#!/usr/bin/env bash
# PM2 entry: load .env then start Deno bot on BOT_HTTP_PORT (default 8788).
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG="${VULTR_BOT_START_LOG:-/var/log/binance-bot-start.log}"

log() { echo "$(date -Is) $*" | tee -a "$LOG"; }

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env" || { log "FATAL: source .env failed"; exit 1; }
  set +a
else
  log "WARN: no $ROOT/.env"
fi

export DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"
export PATH="$DENO_INSTALL/bin:/usr/local/bin:/usr/bin:$PATH"
export BOT_HTTP_PORT="${BOT_HTTP_PORT:-8788}"
export SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${DB_SERVICE_ROLE_KEY:-}}"

if ! command -v deno >/dev/null 2>&1; then
  log "FATAL: deno not in PATH"
  exit 1
fi

for req in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY BOT_SECRET; do
  if [[ -z "${!req:-}" ]]; then
    log "FATAL: missing $req in .env (bot cannot start)"
    exit 1
  fi
done

GW="${BINANCE_REST_GATEWAY_URL:-}"
if [[ -z "$GW" ]]; then
  log "WARN: BINANCE_REST_GATEWAY_URL unset — live Binance will fail if API key is IP-restricted"
else
  log "gateway=${GW} (Binance REST via nginx)"
fi

log "starting deno bot port=${BOT_HTTP_PORT} supabase=${SUPABASE_URL:0:40}..."

exec deno run \
  --allow-net \
  --allow-env \
  --allow-read \
  --config "$ROOT/supabase/functions/binance-bot/deno.json" \
  "$ROOT/supabase/functions/binance-bot/index.ts" \
  2>>"$LOG"

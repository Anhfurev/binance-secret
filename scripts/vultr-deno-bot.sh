#!/usr/bin/env bash
# PM2 entry: load /root/binance-bot/.env then start Deno bot (Edge code on Vultr).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"
export PATH="$DENO_INSTALL/bin:$PATH"
export BOT_HTTP_PORT="${BOT_HTTP_PORT:-8788}"

exec deno run \
  --allow-net \
  --allow-env \
  --allow-read \
  --config "$ROOT/supabase/functions/binance-bot/deno.json" \
  "$ROOT/supabase/functions/binance-bot/index.ts"

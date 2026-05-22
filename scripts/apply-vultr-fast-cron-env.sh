#!/usr/bin/env bash
# Merge fast-cron / low-log env into Vultr /root/binance-bot/.env and restart PM2.
# Run from Mac:  bash scripts/apply-vultr-fast-cron-env.sh
# Or on VPS:     bash /root/binance-bot/scripts/apply-vultr-fast-cron-env.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-45.76.115.143}"
REMOTE_USER="${REMOTE_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_ENV="/root/binance-bot/.env"

# Defaults (override by exporting before run)
POST_BATCH_BALANCE_SYNC_BLOCKING="${POST_BATCH_BALANCE_SYNC_BLOCKING:-0}"
DECISION_TRACE_DB_LOGS="${DECISION_TRACE_DB_LOGS:-0}"
EXECUTION_OUTCOME_DB_LOGS="${EXECUTION_OUTCOME_DB_LOGS:-0}"
BINANCE_WS_MARKET_CACHE="${BINANCE_WS_MARKET_CACHE:-0}"
MARKET_STREAM_PREFETCH_ENABLED="${MARKET_STREAM_PREFETCH_ENABLED:-1}"
BINANCE_STREAM_TICK_GATEWAY_URL="${BINANCE_STREAM_TICK_GATEWAY_URL:-http://127.0.0.1:8787}"
CRON_LATENCY_WARN_MS="${CRON_LATENCY_WARN_MS:-25000}"

merge_block() {
  local env_file="$1"
  touch "$env_file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *"="* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$env_file"
    else
      echo "${key}=${val}" >> "$env_file"
    fi
  done
}

ENV_BLOCK="$(mktemp)"
chmod 600 "$ENV_BLOCK"
cat >"$ENV_BLOCK" <<EOF
# Fast cron (added $(date -Is))
POST_BATCH_BALANCE_SYNC_BLOCKING=${POST_BATCH_BALANCE_SYNC_BLOCKING}
DECISION_TRACE_DB_LOGS=${DECISION_TRACE_DB_LOGS}
EXECUTION_OUTCOME_DB_LOGS=${EXECUTION_OUTCOME_DB_LOGS}
BINANCE_WS_MARKET_CACHE=${BINANCE_WS_MARKET_CACHE}
MARKET_STREAM_PREFETCH_ENABLED=${MARKET_STREAM_PREFETCH_ENABLED}
BINANCE_STREAM_TICK_GATEWAY_URL=${BINANCE_STREAM_TICK_GATEWAY_URL}
CRON_LATENCY_WARN_MS=${CRON_LATENCY_WARN_MS}
EOF

if [[ "${1:-}" == "--local" ]]; then
  ENV_FILE="${ENV_FILE:-$ROOT/.env}"
  echo "==> Merging into ${ENV_FILE}"
  merge_block "$ENV_FILE" < "$ENV_BLOCK"
  rm -f "$ENV_BLOCK"
  grep -E '^(POST_BATCH_BALANCE_SYNC_BLOCKING|DECISION_TRACE_DB_LOGS|EXECUTION_OUTCOME_DB_LOGS|BINANCE_WS_MARKET_CACHE|MARKET_STREAM_PREFETCH_ENABLED|BINANCE_STREAM_TICK_GATEWAY_URL|CRON_LATENCY_WARN_MS)=' "$ENV_FILE" || true
  if command -v pm2 >/dev/null 2>&1; then
    cd "$ROOT"
    pm2 restart binance-bot --update-env || pm2 start ecosystem.vultr.config.cjs --only binance-bot
    pm2 save
  fi
  echo "==> Done (local)."
  exit 0
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[[ -f "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

echo "==> Uploading fast-cron env to ${REMOTE}:${REMOTE_ENV}"
scp "${SSH_OPTS[@]}" "$ENV_BLOCK" "${REMOTE}:/tmp/fast-cron-env.merge"
rm -f "$ENV_BLOCK"

ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
ENV_FILE="/root/binance-bot/.env"
MERGE="/tmp/fast-cron-env.merge"
touch "$ENV_FILE"
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == *"="* ]] || continue
  [[ "$line" =~ ^# ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
done < "$MERGE"
rm -f "$MERGE"
cd /root/binance-bot
pm2 delete binance-bot 2>/dev/null || true
pm2 start ecosystem.vultr.config.cjs --only binance-bot --update-env
pm2 save
echo ""
echo "==> Set on VPS:"
grep -E '^(POST_BATCH_BALANCE_SYNC_BLOCKING|DECISION_TRACE_DB_LOGS|EXECUTION_OUTCOME_DB_LOGS|BINANCE_WS_MARKET_CACHE|MARKET_STREAM_PREFETCH_ENABLED|BINANCE_STREAM_TICK_GATEWAY_URL|CRON_LATENCY_WARN_MS)=' "$ENV_FILE"
REMOTE_SCRIPT

echo "==> Done. Cron should return faster; fewer rows in public.logs."

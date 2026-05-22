#!/usr/bin/env bash
# Mac → Vultr: merge Telegram + 2-min digest vars from .env.local into /root/binance-bot/.env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="${ROOT}/.env.local"
REMOTE_HOST="${REMOTE_HOST:-45.76.115.143}"
REMOTE_USER="${REMOTE_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_ENV="/root/binance-bot/.env"

[[ -f "$ENV_LOCAL" ]] || { echo "Missing $ENV_LOCAL"; exit 1; }

get_var() {
  local key="$1"
  local line val
  line="$(grep -E "^${key}=" "$ENV_LOCAL" | tail -1 || true)"
  val="${line#*=}"
  val="${val%$'\r'}"
  val="$(printf '%s' "$val" | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  printf '%s' "$val"
}

TOKEN="$(get_var TELEGRAM_BOT_TOKEN)"
CHAT="$(get_var TELEGRAM_CHAT_ID)"
DIGEST="$(get_var TELEGRAM_CRON_DIGEST)"
DIGEST_MS="$(get_var TELEGRAM_CRON_DIGEST_MS)"

[[ -n "$TOKEN" ]] || { echo "TELEGRAM_BOT_TOKEN missing in .env.local"; exit 1; }
[[ -n "$CHAT" ]] || { echo "TELEGRAM_CHAT_ID missing in .env.local"; exit 1; }
[[ -n "$DIGEST" ]] || DIGEST="1"
[[ -n "$DIGEST_MS" ]] || DIGEST_MS="120000"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[[ -f "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

TMP="$(mktemp)"
chmod 600 "$TMP"
{
  echo "TELEGRAM_BOT_TOKEN=${TOKEN}"
  echo "TELEGRAM_CHAT_ID=${CHAT}"
  echo "TELEGRAM_CRON_DIGEST=${DIGEST}"
  echo "TELEGRAM_CRON_DIGEST_MS=${DIGEST_MS}"
} >"$TMP"

echo "==> Uploading Telegram block to ${REMOTE}:${REMOTE_ENV}"
scp "${SSH_OPTS[@]}" "$TMP" "${REMOTE}:/tmp/telegram-env.merge"
rm -f "$TMP"

ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
ENV_FILE="/root/binance-bot/.env"
MERGE="/tmp/telegram-env.merge"
touch "$ENV_FILE"
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == *"="* ]] || continue
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
pm2 restart binance-bot --update-env
pm2 save
echo "Telegram env merged. Keys present:"
grep -E '^TELEGRAM_' "$ENV_FILE" | sed 's/=.*/=***set***/'
REMOTE_SCRIPT

echo "==> Done. Expect Cron digest on Telegram about every 2 minutes."

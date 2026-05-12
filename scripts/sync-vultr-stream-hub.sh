#!/usr/bin/env bash
# Push stream hub sources to Vultr and reinstall the systemd unit under /opt/binance-stream-hub.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/.oracle-gateway.env"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-45.76.115.143}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
REMOTE_DIR="${REMOTE_DIR:-/root/binance-gateway}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-25}"

[[ -f "${ROOT}/scripts/gateway-stream-hub/hub.ts" ]] || {
  echo "Missing ${ROOT}/scripts/gateway-stream-hub/hub.ts" >&2
  exit 1
}
[[ -f "$ENV_FILE" ]] || {
  echo "Missing $ENV_FILE" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$ENV_FILE"
LOCAL_ENV="${ROOT}/.env.local"
if [[ -f "$LOCAL_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_ENV"
  set +a
fi
BOT_WAKE_SECRET="${BOT_WAKE_SECRET:-${BOT_SECRET:-}}"
BINANCE_BOT_WAKE_URL="${BINANCE_BOT_WAKE_URL:-https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot}"

SSH_BASE=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}"
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=8
)

run_ssh() {
  if [[ -n "${GATEWAY_SSH_PASSWORD:-}" ]]; then
    SSHPASS="${GATEWAY_SSH_PASSWORD}" sshpass -e ssh "${SSH_BASE[@]}" "$REMOTE" "$@"
  elif [[ -n "${SSH_KEY:-}" && -f "${SSH_KEY}" ]]; then
    ssh -i "${SSH_KEY}" -o BatchMode=yes "${SSH_BASE[@]}" "$REMOTE" "$@"
  else
    ssh "${SSH_BASE[@]}" "$REMOTE" "$@"
  fi
}

run_scp() {
  local src="$1" dest="$2"
  if [[ -n "${GATEWAY_SSH_PASSWORD:-}" ]]; then
    SSHPASS="${GATEWAY_SSH_PASSWORD}" sshpass -e scp "${SSH_BASE[@]}" "$src" "$dest"
  elif [[ -n "${SSH_KEY:-}" && -f "${SSH_KEY}" ]]; then
    scp -i "${SSH_KEY}" -o BatchMode=yes "${SSH_BASE[@]}" "$src" "$dest"
  else
    scp "${SSH_BASE[@]}" "$src" "$dest"
  fi
}

echo "==> Uploading stream hub to ${REMOTE}"
run_ssh "mkdir -p ~/gateway-stream-hub ${REMOTE_DIR}/scripts/gateway-stream-hub"
run_scp "${ROOT}/scripts/gateway-stream-hub/"* "${REMOTE}:~/gateway-stream-hub/"
run_ssh "cp -R ~/gateway-stream-hub/. ${REMOTE_DIR}/scripts/gateway-stream-hub/"

echo "==> Installing stream hub under /opt/binance-stream-hub"
run_ssh "BOT_WAKE_SECRET='${BOT_WAKE_SECRET:-}' BINANCE_BOT_WAKE_URL='${BINANCE_BOT_WAKE_URL}' bash ${REMOTE_DIR}/scripts/fix-vultr-stream-hub-deno.sh"

echo "==> Verify loopback health"
run_ssh "curl -fsS --max-time 5 http://127.0.0.1:8787/healthz"

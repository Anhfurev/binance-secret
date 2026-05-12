#!/usr/bin/env bash
# Mac: install Binance REST gateway on Vultr (Debian/Ubuntu) via SSH password or key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/.oracle-gateway.env"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-45.76.115.143}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-25}"

[[ -f "$ENV_FILE" ]] || {
  echo "Missing $ENV_FILE — set BINANCE_GATEWAY_SECRET + BINANCE_REST_GATEWAY_URL" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$ENV_FILE"
[[ -n "${BINANCE_GATEWAY_SECRET:-}" ]] || {
  echo "BINANCE_GATEWAY_SECRET missing in $ENV_FILE" >&2
  exit 1
}
LOCAL_ENV="${ROOT}/.env.local"
if [[ -f "$LOCAL_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_ENV"
  set +a
fi
BOT_WAKE_SECRET="${BOT_WAKE_SECRET:-${BOT_SECRET:-}}"
BINANCE_BOT_WAKE_URL="${BINANCE_BOT_WAKE_URL:-https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot}"
REMOTE_DIR="${REMOTE_DIR:-/root/binance-gateway}"

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

echo "==> Pushing repo from Mac to ${REMOTE}:${REMOTE_DIR:-/root/binance-gateway}/"
bash "${ROOT}/scripts/push-vultr-gateway.sh"

echo "==> SSH preflight to ${REMOTE}..."
run_ssh 'echo gateway_ssh_ok'

echo "==> Uploading setup script..."
run_scp "${ROOT}/scripts/vultr-stable-gateway-setup.sh" "${REMOTE}:~/vultr-stable-gateway-setup.sh"

echo "==> Uploading WebSocket stream hub..."
run_ssh "rm -rf ~/gateway-stream-hub && mkdir -p ~/gateway-stream-hub"
run_scp "${ROOT}/scripts/gateway-stream-hub/"* "${REMOTE}:~/gateway-stream-hub/"

echo "==> Running nginx gateway setup on VM..."
run_ssh "chmod +x ~/vultr-stable-gateway-setup.sh && BINANCE_GATEWAY_SECRET='${BINANCE_GATEWAY_SECRET}' bash ~/vultr-stable-gateway-setup.sh"

echo "==> Installing stream hub under /opt/binance-stream-hub..."
run_ssh "BOT_WAKE_SECRET='${BOT_WAKE_SECRET:-}' BINANCE_BOT_WAKE_URL='${BINANCE_BOT_WAKE_URL}' bash ${REMOTE_DIR}/scripts/fix-vultr-stream-hub-deno.sh"

echo "==> Verify (from Mac):"
echo "curl -fsS --max-time 10 http://${REMOTE_HOST}/healthz"
echo "curl -fsS --max-time 15 -H 'X-Binance-Gateway-Secret: <from ${ENV_FILE}>' http://${REMOTE_HOST}/api/v3/ping"

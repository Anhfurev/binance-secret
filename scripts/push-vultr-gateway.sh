#!/usr/bin/env bash
# Mac-only: push this repo to the Vultr Sydney gateway VM (source -> target).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/.oracle-gateway.env"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-45.76.115.143}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
REMOTE_DIR="${REMOTE_DIR:-/root/binance-gateway}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-25}"

[[ -f "$ENV_FILE" ]] || {
  echo "Missing $ENV_FILE — set BINANCE_REST_GATEWAY_URL + BINANCE_GATEWAY_SECRET" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$ENV_FILE"

SSH_BASE=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}"
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=8
)

RSYNC_EXCLUDES=(
  --exclude '.next'
  --exclude 'node_modules'
  --exclude '.git'
)

run_rsync() {
  if [[ -n "${GATEWAY_SSH_PASSWORD:-}" ]]; then
    SSHPASS="${GATEWAY_SSH_PASSWORD}" rsync -avz --progress "${RSYNC_EXCLUDES[@]}" \
      -e "sshpass -e ssh ${SSH_BASE[*]}" \
      "${ROOT}/" "${REMOTE}:${REMOTE_DIR}/"
    return
  fi
  if [[ -n "${SSH_KEY:-}" && -f "${SSH_KEY}" ]]; then
    rsync -avz --progress "${RSYNC_EXCLUDES[@]}" \
      -e "ssh -i ${SSH_KEY} -o BatchMode=yes ${SSH_BASE[*]}" \
      "${ROOT}/" "${REMOTE}:${REMOTE_DIR}/"
    return
  fi
  rsync -avz --progress "${RSYNC_EXCLUDES[@]}" \
    -e "ssh ${SSH_BASE[*]}" \
    "${ROOT}/" "${REMOTE}:${REMOTE_DIR}/"
}

run_ssh() {
  if [[ -n "${GATEWAY_SSH_PASSWORD:-}" ]]; then
    SSHPASS="${GATEWAY_SSH_PASSWORD}" sshpass -e ssh "${SSH_BASE[@]}" "$REMOTE" "$@"
    return
  fi
  if [[ -n "${SSH_KEY:-}" && -f "${SSH_KEY}" ]]; then
    ssh -i "${SSH_KEY}" -o BatchMode=yes "${SSH_BASE[@]}" "$REMOTE" "$@"
    return
  fi
  ssh "${SSH_BASE[@]}" "$REMOTE" "$@"
}

echo "==> Pushing ${ROOT} -> ${REMOTE}:${REMOTE_DIR}/"
run_rsync
echo "==> Remote scripts:"
run_ssh "ls -la ${REMOTE_DIR}/scripts/ | head -n 20"

#!/usr/bin/env bash
# Mac: push gateway setup to Oracle VM using scripts/.oracle-gateway.env (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/.oracle-gateway.env"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_USER="${REMOTE_USER:-opc}"
REMOTE_HOST="${REMOTE_HOST:-64.110.105.147}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-20}"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}"
  -o ConnectionAttempts=1
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)

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
[[ -f "$SSH_KEY" ]] || {
  echo "SSH key missing: $SSH_KEY" >&2
  exit 1
}

echo "==> SSH preflight to ${REMOTE} (timeout ${SSH_CONNECT_TIMEOUT}s)..."
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" 'echo gateway_ssh_ok'; then
  cat >&2 <<EOF
SSH failed or timed out. Stop waiting on a hung session (Ctrl+C), then in OCI:
  - Security list / NSG: allow inbound TCP 22 from your IP
  - Instance running; VNIC has public IP ${REMOTE_HOST}
  - Test: ssh -i ${SSH_KEY} ${REMOTE} 'echo ok'
EOF
  exit 1
fi

echo "==> Uploading setup script..."
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/oracle-stable-gateway-setup.sh" "${REMOTE}:~/oracle-stable-gateway-setup.sh"

echo "==> Running nginx gateway setup on VM (background; dnf can take several minutes)..."
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "nohup env ORACLE_GATEWAY_SKIP_DNF_UPDATE=1 BINANCE_GATEWAY_SECRET='${BINANCE_GATEWAY_SECRET}' bash ~/oracle-stable-gateway-setup.sh > ~/oracle-gateway-setup.log 2>&1 < /dev/null & echo gateway_setup_pid=\$!"

RUN_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}"
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=120
)

for attempt in $(seq 1 90); do
  sleep 10
  status="$(ssh "${RUN_OPTS[@]}" "$REMOTE" \
    'if grep -q "^=== Done ===" ~/oracle-gateway-setup.log 2>/dev/null; then echo done; elif pgrep -f oracle-stable-gateway-setup.sh >/dev/null; then echo running; elif [[ -s ~/oracle-gateway-setup.log ]]; then echo failed; else echo waiting; fi' \
    2>/dev/null || echo ssh_err)"
  echo "    [${attempt}/90] remote status: ${status}"
  if [[ "$status" == "done" ]]; then
    ssh "${RUN_OPTS[@]}" "$REMOTE" 'tail -n 20 ~/oracle-gateway-setup.log'
    break
  fi
  if [[ "$status" == "failed" || "$status" == "ssh_err" ]]; then
    ssh "${RUN_OPTS[@]}" "$REMOTE" 'tail -n 40 ~/oracle-gateway-setup.log' 2>/dev/null || true
    echo "Gateway setup did not finish. See log on VM: ~/oracle-gateway-setup.log" >&2
    exit 1
  fi
done
if [[ "${status:-}" != "done" ]]; then
  echo "Timed out waiting for gateway setup. Check VM log: ~/oracle-gateway-setup.log" >&2
  exit 1
fi

echo "==> Verify (from Mac):"
echo "curl -fsS --max-time 10 http://${REMOTE_HOST}/healthz"
echo "curl -fsS --max-time 15 -H 'X-Binance-Gateway-Secret: <from ${ENV_FILE}>' http://${REMOTE_HOST}/api/v3/ping"

#!/usr/bin/env bash
# Run on the Vultr gateway as root after rsync.
set -euo pipefail

export DENO_INSTALL="${DENO_INSTALL:-/root/.deno}"
export PATH="${DENO_INSTALL}/bin:${PATH}"

if ! command -v deno >/dev/null 2>&1; then
  curl -fsSL https://deno.land/install.sh | sh
fi
DENO_BIN="$(command -v deno)"
echo "deno=${DENO_BIN}"

HUB_SRC="${HUB_SRC:-/root/binance-gateway/scripts/gateway-stream-hub}"
HUB_DIR="${HUB_DIR:-/opt/binance-stream-hub}"
[[ -d "${HUB_SRC}" ]] || {
  echo "Missing hub source: ${HUB_SRC}" >&2
  exit 1
}
mkdir -p "${HUB_DIR}"
cp -R "${HUB_SRC}/." "${HUB_DIR}/"

ENV_FILE="${ENV_FILE:-/root/binance-gateway/scripts/.oracle-gateway.env}"
if [[ -z "${BINANCE_GATEWAY_SECRET:-}" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi
[[ -n "${BINANCE_GATEWAY_SECRET:-}" ]] || {
  echo "Set BINANCE_GATEWAY_SECRET or populate ${ENV_FILE}" >&2
  exit 1
}

tee /etc/systemd/system/binance-stream-hub.service >/dev/null <<UNIT
[Unit]
Description=Binance WebSocket stream hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${HUB_DIR}
Environment=BINANCE_GATEWAY_SECRET=${BINANCE_GATEWAY_SECRET}
Environment=STREAM_HUB_PORT=8787
Environment=STREAM_SYMBOLS=BTCUSDT,SOLUSDT,PEPEUSDT
Environment=WICK_WAKE_DROP_PCT_PEPEUSDT=2.0
Environment=BINANCE_BOT_WAKE_URL=${BINANCE_BOT_WAKE_URL:-}
Environment=BOT_WAKE_SECRET=${BOT_WAKE_SECRET:-}
ExecStart=${DENO_BIN} run --no-config --allow-net --allow-env ${HUB_DIR}/main.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now binance-stream-hub.service
systemctl status binance-stream-hub --no-pager || true
journalctl -u binance-stream-hub -n 20 --no-pager || true

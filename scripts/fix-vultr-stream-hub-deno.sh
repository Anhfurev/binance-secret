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

ensure_hub_entry() {
  local dir="$1"
  [[ -d "${dir}" ]] || return 1
  if [[ -f "${dir}/hub.ts" ]]; then
    return 0
  fi
  if [[ -f "${dir}/main.ts" ]]; then
    printf 'import "./main.ts";\n' > "${dir}/hub.ts"
    return 0
  fi
  return 1
}

HUB_SRC="${HUB_SRC:-/root/binance-gateway/scripts/gateway-stream-hub}"
if [[ ! -d "${HUB_SRC}" && -d /root/gateway-stream-hub ]]; then
  HUB_SRC="/root/gateway-stream-hub"
fi
HUB_DIR="${HUB_DIR:-/opt/binance-stream-hub}"
[[ -d "${HUB_SRC}" ]] || {
  echo "Missing hub source: ${HUB_SRC}" >&2
  exit 1
}
ensure_hub_entry "${HUB_SRC}" || {
  echo "Missing hub.ts (and main.ts) under ${HUB_SRC}" >&2
  exit 1
}
mkdir -p "${HUB_DIR}"
cp -R "${HUB_SRC}/." "${HUB_DIR}/"
ensure_hub_entry "${HUB_DIR}" || {
  echo "Missing ${HUB_DIR}/hub.ts after copy from ${HUB_SRC}" >&2
  exit 1
}

ENV_FILE="${ENV_FILE:-/root/binance-gateway/scripts/.oracle-gateway.env}"
if [[ -z "${BINANCE_GATEWAY_SECRET:-}" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi
[[ -n "${BINANCE_GATEWAY_SECRET:-}" ]] || {
  echo "Set BINANCE_GATEWAY_SECRET or populate ${ENV_FILE}" >&2
  exit 1
}

BINANCE_BOT_WAKE_URL="${BINANCE_BOT_WAKE_URL:-https://emviaygygylosvmtsvlq.supabase.co/functions/v1/binance-bot}"
if [[ -z "${BOT_WAKE_SECRET:-}" ]]; then
  echo "WARN: BOT_WAKE_SECRET unset — stream wick wakes to binance-bot are disabled until set (same value as Edge BOT_SECRET)." >&2
fi

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
Environment=STREAM_SYMBOLS=ADAUSDT,AVAXUSDT,BNBUSDT,BTCUSDT,DOGEUSDT,ETHUSDT,LINKUSDT,PEPEUSDT,SOLUSDT,XRPUSDT
Environment=WICK_WAKE_DROP_PCT_PEPEUSDT=2.5
Environment=BINANCE_BOT_WAKE_URL=${BINANCE_BOT_WAKE_URL:-}
Environment=BOT_WAKE_SECRET=${BOT_WAKE_SECRET:-}
ExecStart=${DENO_BIN} run --no-config --allow-net --allow-env ${HUB_DIR}/hub.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now binance-stream-hub.service
systemctl status binance-stream-hub --no-pager || true
journalctl -u binance-stream-hub -n 20 --no-pager || true

#!/usr/bin/env bash
# Run ON Debian/Ubuntu gateway VM (e.g. Vultr Sydney) as root.
# Optional: BINANCE_GATEWAY_SECRET=... bash vultr-stable-gateway-setup.sh
set -euo pipefail

GATEWAY_SECRET="${BINANCE_GATEWAY_SECRET:-}"
if [[ -z "${GATEWAY_SECRET}" ]]; then
  GATEWAY_SECRET="$(openssl rand -hex 24)"
  echo "Generated BINANCE_GATEWAY_SECRET (save on Supabase Edge + here): ${GATEWAY_SECRET}"
fi

echo "=== Nginx reverse proxy (Binance REST) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx curl

rm -f /etc/nginx/sites-enabled/default
tee /etc/nginx/conf.d/binance-gateway.conf >/dev/null <<NGX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location = /healthz {
        default_type text/plain;
        return 200 "ok\n";
    }

    location /stream/ {
        # Loopback only — never proxy stream hub via the VM public IP (adds RTT on wicks).
        if (\$http_x_binance_gateway_secret != "${GATEWAY_SECRET}") {
            return 403;
        }
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    location / {
        if (\$http_x_binance_gateway_secret != "${GATEWAY_SECRET}") {
            return 403;
        }
        proxy_pass https://api.binance.com;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_set_header Host api.binance.com;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 15s;
        proxy_read_timeout 60s;
    }
}
NGX

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "=== Binance WebSocket stream hub (Deno) ==="
export DENO_INSTALL="${DENO_INSTALL:-/root/.deno}"
export PATH="${DENO_INSTALL}/bin:/usr/local/bin:/usr/bin:${PATH}"
if ! command -v deno >/dev/null 2>&1; then
  curl -fsSL https://deno.land/install.sh | sh
fi
DENO_BIN="$(command -v deno)"
echo "Using deno at ${DENO_BIN}"

HUB_DIR="/opt/binance-stream-hub"
mkdir -p "${HUB_DIR}"
HUB_SRC=""
if [[ -d /root/binance-gateway/scripts/gateway-stream-hub ]]; then
  HUB_SRC="/root/binance-gateway/scripts/gateway-stream-hub"
elif [[ -d /root/gateway-stream-hub ]]; then
  HUB_SRC="/root/gateway-stream-hub"
fi
if [[ -n "${HUB_SRC}" ]]; then
  cp -R "${HUB_SRC}/." "${HUB_DIR}/"
fi
if [[ ! -f "${HUB_DIR}/hub.ts" && -f "${HUB_DIR}/main.ts" ]]; then
  printf 'import "./main.ts";\n' > "${HUB_DIR}/hub.ts"
fi
if [[ ! -f "${HUB_DIR}/hub.ts" ]]; then
  echo "Missing ${HUB_DIR}/hub.ts — sync scripts/gateway-stream-hub to the VM first." >&2
  exit 1
fi

tee /etc/systemd/system/binance-stream-hub.service >/dev/null <<UNIT
[Unit]
Description=Binance WebSocket stream hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${HUB_DIR}
Environment=BINANCE_GATEWAY_SECRET=${GATEWAY_SECRET}
Environment=STREAM_HUB_PORT=8787
Environment=STREAM_SYMBOLS=BTCUSDT,SOLUSDT,PEPEUSDT
Environment=WICK_WAKE_DROP_PCT_PEPEUSDT=2.5
ExecStart=${DENO_BIN} run --no-config --allow-net --allow-env ${HUB_DIR}/hub.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now binance-stream-hub.service || true

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw reload
else
  echo "ufw inactive; open ports 80/443 in the cloud firewall if needed."
fi

PUBLIC_IP="$(curl -fsS --max-time 15 https://api.ipify.org || true)"
echo "=== Done ==="
echo "Public IP: ${PUBLIC_IP:-unknown}"
echo "Health: http://YOUR_VM_IP/healthz"
echo "Stream tick: curl -H 'X-Binance-Gateway-Secret: <secret>' 'http://YOUR_VM_IP/stream/tick?symbol=PEPEUSDT'"
echo "Binance ping via gateway (needs header): curl -H 'X-Binance-Gateway-Secret: <secret>' http://YOUR_VM_IP/api/v3/ping"
echo "Supabase Edge secrets:"
echo "  BINANCE_REST_GATEWAY_URL=http://${PUBLIC_IP:-YOUR_VM_IP}"
echo "  BINANCE_GATEWAY_SECRET=${GATEWAY_SECRET}"
echo "Binance API key IP allowlist: ${PUBLIC_IP:-YOUR_VM_IP}"

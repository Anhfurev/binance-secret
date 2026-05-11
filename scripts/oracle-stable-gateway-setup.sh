#!/usr/bin/env bash
# Run ON the Oracle Linux VM as opc (with sudo).
# Optional: BINANCE_GATEWAY_SECRET=... bash oracle-stable-gateway-setup.sh
set -euo pipefail

GATEWAY_SECRET="${BINANCE_GATEWAY_SECRET:-}"
if [[ -z "${GATEWAY_SECRET}" ]]; then
  GATEWAY_SECRET="$(openssl rand -hex 24)"
  echo "Generated BINANCE_GATEWAY_SECRET (save on Supabase Edge + here): ${GATEWAY_SECRET}"
fi

ensure_swap_if_low_mem() {
  local mem_kb avail_kb swap_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
  if [[ "${mem_kb:-0}" -gt 1800000 && "${swap_kb:-0}" -gt 500000 ]]; then
    return 0
  fi
  if [[ -f /swapfile ]] && swapon --show | grep -q /swapfile; then
    return 0
  fi
  echo "=== Low RAM (${mem_kb:-?} kB); adding 2G swap for dnf/nginx ==="
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
}

echo "=== Nginx reverse proxy (Binance REST) ==="
ensure_swap_if_low_mem
if [[ "${ORACLE_GATEWAY_SKIP_DNF_UPDATE:-0}" != "1" ]]; then
  echo "=== dnf update (skip with ORACLE_GATEWAY_SKIP_DNF_UPDATE=1) ==="
  sudo dnf update -y
fi
echo "=== dnf install nginx ==="
sudo dnf install -y nginx --setopt=install_weak_deps=False
sudo tee /etc/nginx/conf.d/binance-gateway.conf >/dev/null <<NGX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location = /healthz {
        default_type text/plain;
        return 200 "ok\n";
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
sudo nginx -t
sudo systemctl enable --now nginx

echo "=== Firewall (firewalld): HTTP / HTTPS ==="
if sudo systemctl is-active --quiet firewalld; then
  sudo firewall-cmd --permanent --add-service=http
  sudo firewall-cmd --permanent --add-service=https
  sudo firewall-cmd --reload
  sudo firewall-cmd --list-services
else
  echo "firewalld not active; open ports 80/443 in OCI Security List / NSG if needed."
fi

PUBLIC_IP="$(curl -fsS --max-time 15 https://api.ipify.org || true)"
echo "=== Done ==="
echo "Public IP: ${PUBLIC_IP:-unknown}"
echo "Health: http://YOUR_VM_IP/healthz"
echo "Binance ping via gateway (needs header): curl -H 'X-Binance-Gateway-Secret: <secret>' http://YOUR_VM_IP/api/v3/ping"
echo "Supabase Edge secrets:"
echo "  BINANCE_REST_GATEWAY_URL=http://${PUBLIC_IP:-YOUR_VM_IP}"
echo "  BINANCE_GATEWAY_SECRET=${GATEWAY_SECRET}"
echo "Binance API key IP allowlist: ${PUBLIC_IP:-YOUR_VM_IP}"

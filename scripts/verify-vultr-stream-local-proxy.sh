#!/usr/bin/env bash
# On the Vultr gateway: confirm stream hub proxy uses loopback (not public IP).
set -euo pipefail
CONF="${1:-/etc/nginx/conf.d/binance-gateway.conf}"
if [[ ! -f "$CONF" ]]; then
  echo "missing nginx config: $CONF" >&2
  exit 1
fi
if grep -q 'proxy_pass http://127.0.0.1:8787' "$CONF"; then
  echo "ok: stream hub proxy_pass uses 127.0.0.1:8787"
else
  echo "FAIL: expected proxy_pass http://127.0.0.1:8787/ in $CONF" >&2
  grep -n 'proxy_pass' "$CONF" >&2 || true
  exit 1
fi
if grep -E 'proxy_pass https?://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:8787' "$CONF"; then
  echo "FAIL: stream hub must not proxy to public IP" >&2
  exit 1
fi
curl -fsS --max-time 5 http://127.0.0.1:8787/healthz >/dev/null
echo "ok: hub healthz on loopback"

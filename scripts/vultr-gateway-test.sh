#!/usr/bin/env bash
# Test Binance REST via your Vultr nginx gateway (IP-whitelisted key).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] && set -a && source .env && set +a

GW="${BINANCE_REST_GATEWAY_URL:-}"
SECRET="${BINANCE_GATEWAY_SECRET:-}"
KEY="${BINANCE_API_KEY:-}"
API_SECRET="${BINANCE_API_SECRET:-}"

[[ -n "$GW" ]] || { echo "Set BINANCE_REST_GATEWAY_URL=http://45.76.115.143 in .env"; exit 1; }
[[ -n "$SECRET" ]] || { echo "Set BINANCE_GATEWAY_SECRET in .env"; exit 1; }
[[ -n "$KEY" && -n "$API_SECRET" ]] || { echo "Set BINANCE_API_KEY + BINANCE_API_SECRET"; exit 1; }

GW="${GW%/}"
echo "Gateway health: ${GW}/healthz"
curl -sS --max-time 10 "${GW}/healthz" || true
echo ""

TS=$(date +%s000)
QS="timestamp=${TS}&recvWindow=5000"
SIG=$(echo -n "$QS" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')
URL="${GW}/api/v3/account?${QS}&signature=${SIG}"
echo "Signed account via gateway..."
HTTP=$(curl -sS -w "%{http_code}" -o /tmp/gw-acct.json --max-time 15 \
  -H "X-MBX-APIKEY: ${KEY}" \
  -H "X-Binance-Gateway-Secret: ${SECRET}" \
  "$URL")
echo "HTTP ${HTTP}"
head -c 200 /tmp/gw-acct.json
echo ""

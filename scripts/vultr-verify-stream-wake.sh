#!/usr/bin/env bash
# On Vultr: confirm stream hub wakes local bot on price moves.
set -euo pipefail

echo "=== systemd stream hub env ==="
systemctl show binance-stream-hub -p Environment --no-pager | tr ' ' '\n' | grep -E 'WAKE|WICK|MOVE|STREAM_SYMBOLS|BINANCE_BOT' || true

echo ""
echo "=== recent wake logs (last 20) ==="
journalctl -u binance-stream-hub -n 200 --no-pager 2>/dev/null | grep -E 'wick-wake|move-wake|stream-wake' | tail -20 || echo "(no wake lines yet — wait for a move)"

echo ""
echo "=== bot listening ==="
ss -tlnp | grep 8788 || echo "WARN: nothing on 8788"

#!/usr/bin/env bash
# Hourly paper-scalp cron — call once per hour (not every minute).
# Example crontab: 0 * * * * /path/to/binance/scripts/paper-scalp-heartbeat.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi
PORT="${PORT:-3000}"
SECRET="${CRON_SECRET:-}"
URL="http://127.0.0.1:${PORT}/api/automation/paper/run"
AUTH=()
if [[ -n "$SECRET" ]]; then AUTH=(-H "Authorization: Bearer ${SECRET}"); fi
curl -fsS "${AUTH[@]}" "$URL" || exit 1

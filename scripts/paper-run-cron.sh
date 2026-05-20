#!/usr/bin/env bash
# VPS backup: invoke paper engine every 2m if ws-daemon is down.
# Crontab: */2 * * * * /path/to/binance/scripts/paper-run-cron.sh >> /var/log/paper-run-cron.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi
BASE="${PAPER_RUN_URL:-http://127.0.0.1:3000/api/automation/paper/run}"
SECRET="${CRON_SECRET:-}"
if [[ -z "$SECRET" ]]; then
  echo "[paper-run-cron] skip — CRON_SECRET unset"
  exit 0
fi
curl -fsS -m 90 -X POST "$BASE" \
  -H "Authorization: Bearer $SECRET" \
  -H "x-paper-cron-backup: 1" \
  -o /dev/null -w "[paper-run-cron] %{http_code} %{time_total}s\n"

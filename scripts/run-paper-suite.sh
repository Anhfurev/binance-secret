#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
: "${NEXT_PUBLIC_SUPABASE_URL:?Set NEXT_PUBLIC_SUPABASE_URL}"
: "${BOT_SECRET:?Set BOT_SECRET in $ENV_FILE}"
curl -sS --max-time 120 -X POST "${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/binance-bot" \
  -H 'Content-Type: application/json' \
  -H "x-binance-bot-secret: ${BOT_SECRET}" \
  -d '{"paper_scenario_suite":true,"paper_scenario_execute":false,"paper_scenario_max_cases":50}'

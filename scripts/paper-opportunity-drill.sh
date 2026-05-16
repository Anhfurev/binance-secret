#!/usr/bin/env bash
# Drill: real Binance snapshot → synthetic bullish tape → bot decides (paper only).
#
# Usage (export secrets in your shell; do not commit them):
#   export SUPABASE_PROJECT_REF="your_project_ref"
#   export BINANCE_BOT_SECRET="your_edge_BOT_SECRET"
#   ./scripts/paper-opportunity-drill.sh
#
# Optional:
#   PAPER_SCENARIO=growth_rally   # or momentum_buy (works on older deploys)
#   PAPER_EXECUTE=false             # dry run (default true)
#
# For real LLM on the overlaid snapshot (uses quota; set on Edge then deploy):
#   supabase secrets set PAPER_SCENARIO_USE_LIVE_AI=1 --project-ref "$SUPABASE_PROJECT_REF"

set -euo pipefail
REF="${SUPABASE_PROJECT_REF:?export SUPABASE_PROJECT_REF (e.g. emviaygygylosvmtsvlq)}"
SECRET="${BINANCE_BOT_SECRET:?export BINANCE_BOT_SECRET (Edge secret BOT_SECRET)}"
SCENARIO="${PAPER_SCENARIO:-growth_rally}"
EXEC="${PAPER_EXECUTE:-true}"
URL="https://${REF}.supabase.co/functions/v1/binance-bot"

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-binance-bot-secret: $SECRET" \
  -d "{\"paper_scenario\":\"${SCENARIO}\",\"symbol\":\"BTCUSDT\",\"paper_scenario_execute\":${EXEC}}" | jq .

echo
echo "Expect: \"mode\": \"paper_scenario\". If you see batch_id + trigger cron, deploy binance-bot from this repo or use PAPER_SCENARIO=momentum_buy."

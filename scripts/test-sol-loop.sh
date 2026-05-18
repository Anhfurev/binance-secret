#!/usr/bin/env bash
# Isolated SOLUSDT paper cycle via test-sol-loop (live project, no local serve).
#
#   export SUPABASE_PROJECT_REF="your_project_ref"
#   export BINANCE_BOT_SECRET="your_edge_BOT_SECRET"
#   ./scripts/test-sol-loop.sh
#
# Optional:
#   PAPER_SCENARIO=momentum_buy
#   PAPER_EXECUTE=false

set -euo pipefail
REF="${SUPABASE_PROJECT_REF:?export SUPABASE_PROJECT_REF}"
SECRET="${BINANCE_BOT_SECRET:?export BINANCE_BOT_SECRET}"
SCENARIO="${PAPER_SCENARIO:-}"
EXEC="${PAPER_EXECUTE:-true}"
URL="https://${REF}.supabase.co/functions/v1/test-sol-loop"

BODY='{"test_mode":true}'
if [[ -n "$SCENARIO" ]]; then
  BODY=$(printf '{"test_mode":true,"paper_scenario":"%s","paper_scenario_execute":%s}' "$SCENARIO" "$EXEC")
fi

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-binance-bot-secret: $SECRET" \
  -d "$BODY" | jq .

echo
echo "Expect test_mode:true and symbol SOLUSDT. Deploy test-sol-loop if you get 404."

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
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE}"

TARGET="${PAPER_COHORT_TARGET:-50}"
BATCH_SIZE="${PAPER_SUITE_BATCH_SIZE:-10}"
SLEEP_SEC="${PAPER_COHORT_SLEEP_SEC:-200}"
MAX_WAVES="${PAPER_COHORT_MAX_WAVES:-30}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      BATCH_SIZE="${2:?--limit requires a number}"
      shift 2
      ;;
    --target)
      TARGET="${2:?--target requires a number}"
      shift 2
      ;;
    --sleep)
      SLEEP_SEC="${2:?--sleep requires seconds}"
      shift 2
      ;;
    *)
      echo "unknown arg: $1 (use --limit, --target, --sleep)" >&2
      exit 1
      ;;
  esac
done
COHORT_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
export COHORT_START TARGET SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL

echo "cohort_start=${COHORT_START} target=${TARGET} batch_size=${BATCH_SIZE}"

wave=0
while (( wave < MAX_WAVES )); do
  wave=$((wave + 1))
  echo "==> suite execute wave ${wave}/${MAX_WAVES} (batch ${BATCH_SIZE})"
  curl -sS --max-time 300 -X POST "${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/binance-bot" \
    -H 'Content-Type: application/json' \
    -H "x-binance-bot-secret: ${BOT_SECRET}" \
    -d "{\"paper_scenario_suite\":true,\"paper_scenario_execute\":true,\"paper_scenario_max_cases\":${BATCH_SIZE}}" >/dev/null || true
  curl -sS --max-time 180 -X POST "${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/binance-bot" \
    -H 'Content-Type: application/json' \
    -H "x-binance-bot-secret: ${BOT_SECRET}" \
    -d '{"symbols":["BTCUSDT","SOLUSDT","PEPEUSDT"]}' >/dev/null || true
  node <<'NODE'
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const uid = 'b0694630-fed7-4ed5-83a7-bd351ec02a6a';
const since = process.env.COHORT_START;
const target = Number(process.env.TARGET ?? '50');
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(path) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const trades = await get(`trades?user_id=eq.${uid}&status=in.(closed,stopped)&closed_at=gte.${since}&select=pnl,exit_reason,closed_at,symbol,extra&order=closed_at.asc&limit=500`);
const paper = trades.filter((t) => {
  const extra = t.extra || {};
  if (extra.is_ghost === true) return false;
  return extra.is_paper === true || extra.trade_mode === 'paper';
});
const pnls = paper.map((t) => Number(t.pnl)).filter((n) => Number.isFinite(n));
const wins = pnls.filter((n) => n > 0).length;
const losses = pnls.filter((n) => n < 0).length;
const flats = pnls.filter((n) => n === 0).length;
const sum = pnls.reduce((a, b) => a + b, 0);
const winRateAll = paper.length ? (wins / paper.length) * 100 : 0;
const winRateNonZero = wins + losses ? (wins / (wins + losses)) * 100 : 0;
console.log(JSON.stringify({
  cohort_start: since,
  closed_paper_trades: paper.length,
  wins,
  losses,
  flat_pnl: flats,
  win_rate_all_closed_pct: Number(winRateAll.toFixed(1)),
  win_rate_nonzero_pnl_pct: Number(winRateNonZero.toFixed(1)),
  realized_pnl_usd: Number(sum.toFixed(2)),
  target,
  done: paper.length >= target,
}, null, 2));
if (paper.length >= target) process.exit(2);
NODE
  status=$?
  if [[ "$status" -eq 2 ]]; then
    break
  fi
  sleep "${SLEEP_SEC}"
done

bash "$(dirname "$0")/report-paper-cohort.sh" "${COHORT_START}"

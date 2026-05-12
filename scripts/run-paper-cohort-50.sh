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
SLEEP_SEC="${PAPER_COHORT_SLEEP_SEC:-200}"
MAX_ROUNDS="${PAPER_COHORT_MAX_ROUNDS:-80}"
COHORT_START="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
export COHORT_START TARGET SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL

echo "cohort_start=${COHORT_START} target=${TARGET} sleep_sec=${SLEEP_SEC} max_rounds=${MAX_ROUNDS}"

round=0
while (( round < MAX_ROUNDS )); do
  round=$((round + 1))
  echo "==> cron round ${round}/${MAX_ROUNDS}"
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

node <<'NODE'
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const uid = 'b0694630-fed7-4ed5-83a7-bd351ec02a6a';
const since = process.env.COHORT_START;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(path) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const [open, trades] = await Promise.all([
  get(`trades?user_id=eq.${uid}&status=eq.open&select=symbol,opened_at,extra&limit=50`),
  get(`trades?user_id=eq.${uid}&status=in.(closed,stopped)&closed_at=gte.${since}&select=pnl,exit_reason,closed_at,symbol,extra&order=closed_at.asc&limit=500`),
]);
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
const byExit = {};
for (const t of paper) {
  const k = t.exit_reason || 'unknown';
  byExit[k] = (byExit[k] ?? 0) + 1;
}
console.log(JSON.stringify({
  cohort_start: since,
  closed_paper_trades: paper.length,
  open_paper_trades: open.filter((t) => {
    const extra = t.extra || {};
    return !extra.is_ghost && (extra.is_paper === true || extra.trade_mode === 'paper');
  }).length,
  wins,
  losses,
  flat_pnl: flats,
  win_rate_all_closed_pct: Number(winRateAll.toFixed(1)),
  win_rate_nonzero_pnl_pct: Number(winRateNonZero.toFixed(1)),
  realized_pnl_usd: Number(sum.toFixed(2)),
  exit_reasons: byExit,
}, null, 2));
NODE

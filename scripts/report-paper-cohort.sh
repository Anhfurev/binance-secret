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
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE}"
COHORT_START="${1:-}"
if [[ -z "$COHORT_START" ]]; then
  echo "usage: $0 <cohort_start_iso>" >&2
  exit 1
fi
export COHORT_START SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL
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
const [open, closed] = await Promise.all([
  get(`trades?user_id=eq.${uid}&status=eq.open&select=symbol,opened_at,extra&limit=50`),
  get(`trades?user_id=eq.${uid}&status=in.(closed,stopped)&closed_at=gte.${since}&select=pnl,exit_reason,closed_at,symbol,extra&order=closed_at.asc&limit=500`),
]);
const isPaper = (t) => {
  const extra = t.extra || {};
  if (extra.is_ghost === true) return false;
  return extra.is_paper === true || extra.trade_mode === 'paper';
};
const paperClosed = closed.filter(isPaper);
const paperOpen = open.filter(isPaper);
const pnls = paperClosed.map((t) => Number(t.pnl)).filter((n) => Number.isFinite(n));
const wins = pnls.filter((n) => n > 0).length;
const losses = pnls.filter((n) => n < 0).length;
const flats = pnls.filter((n) => n === 0).length;
const sum = pnls.reduce((a, b) => a + b, 0);
const winRateAll = paperClosed.length ? (wins / paperClosed.length) * 100 : 0;
const winRateNonZero = wins + losses ? (wins / (wins + losses)) * 100 : 0;
const byExit = {};
for (const t of paperClosed) {
  const k = t.exit_reason || 'unknown';
  byExit[k] = (byExit[k] ?? 0) + 1;
}
console.log(JSON.stringify({
  cohort_start: since,
  closed_paper_trades: paperClosed.length,
  open_paper_trades: paperOpen.length,
  wins,
  losses,
  flat_pnl: flats,
  win_rate_all_closed_pct: Number(winRateAll.toFixed(1)),
  win_rate_nonzero_pnl_pct: Number(winRateNonZero.toFixed(1)),
  realized_pnl_usd: Number(sum.toFixed(2)),
  exit_reasons: byExit,
}, null, 2));
NODE

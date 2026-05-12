#!/usr/bin/env bash
# Export paper cohort trades to archives/ for a clean mental slate (no deletes unless --apply).
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

SINCE="${1:-}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
  SINCE="${2:-}"
fi
if [[ -z "$SINCE" ]]; then
  echo "usage: $0 [--apply] <cohort_start_iso>" >&2
  echo "  exports paper trades opened_at >= cohort_start to archives/" >&2
  echo "  --apply tags extra.cohort_archived=true (does not delete rows)" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${ROOT}/archives/paper-cohorts"
mkdir -p "$OUT_DIR"
OUT_FILE="${OUT_DIR}/cohort-${STAMP}.json"

export SINCE OUT_FILE SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL APPLY="${APPLY}"
node <<'NODE'
import fs from "node:fs";
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const since = process.env.SINCE;
const outFile = process.env.OUT_FILE;
const uid = "b0694630-fed7-4ed5-83a7-bd351ec02a6a";
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(path) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const rows = await get(
  `trades?user_id=eq.${uid}&opened_at=gte.${since}&select=id,symbol,status,pnl,exit_reason,opened_at,closed_at,extra&order=opened_at.asc&limit=1000`,
);
const paper = rows.filter((t) => {
  const extra = t.extra || {};
  if (extra.is_ghost) return false;
  return extra.is_paper === true || extra.trade_mode === "paper";
});
fs.writeFileSync(outFile, JSON.stringify({ cohort_start: since, exported_at: new Date().toISOString(), trades: paper }, null, 2));
console.log(JSON.stringify({ archived_to: outFile, trade_count: paper.length }, null, 2));
if (process.env.APPLY === "1") {
  const patchHeaders = { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" };
  let tagged = 0;
  for (const row of paper) {
    const extra = { ...(row.extra || {}), cohort_archived: true, cohort_archived_at: new Date().toISOString() };
    const r = await fetch(`${base}/rest/v1/trades?id=eq.${row.id}`, { method: "PATCH", headers: patchHeaders, body: JSON.stringify({ extra }) });
    if (!r.ok) throw new Error(await r.text());
    tagged += 1;
  }
  console.log(JSON.stringify({ tagged_cohort_archived: tagged }, null, 2));
}
NODE

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-emviaygygylosvmtsvlq}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
# Primary + numbered keys (see supabase/functions/binance-bot/ai-keys.ts)
grep -E '^GEMINI_(API_KEY|KEY_)' "$ENV_FILE" > "$TMP" || true
if [[ ! -s "$TMP" ]]; then
  echo "No GEMINI_API_KEY / GEMINI_API_KEY* / GEMINI_KEY_* entries found in $ENV_FILE" >&2
  exit 1
fi
supabase secrets set --env-file "$TMP" --project-ref "$PROJECT_REF" --yes
echo "Pushed $(wc -l < "$TMP" | tr -d ' ') Gemini secret(s) to Supabase Edge."

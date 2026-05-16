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
grep -E '^GROQ_API_KEY' "$ENV_FILE" > "$TMP" || true
grep -E '^GROQ_(MIN_REQUEST_GAP_MS|COOLDOWN_DURATION_SEC|PERMANENT_FAILURE_COOLDOWN_SEC)=' "$ENV_FILE" >> "$TMP" || true
grep -E '^BOT_PARALLEL_SYMBOL_CYCLES=' "$ENV_FILE" >> "$TMP" || true
grep -E '^AI_PRIMARY_LLM=' "$ENV_FILE" >> "$TMP" || true
grep -E '^GROQ_MULTI_SYMBOL_BATCH=' "$ENV_FILE" >> "$TMP" || true
if [[ ! -s "$TMP" ]]; then
  echo "No GROQ_API_KEY* entries found in $ENV_FILE" >&2
  exit 1
fi
supabase secrets set --env-file "$TMP" --project-ref "$PROJECT_REF" --yes
echo "Pushed $(wc -l < "$TMP" | tr -d ' ') Groq secret(s) to Supabase edge."

#!/usr/bin/env bash
# Pack GROQ_API_KEY1..N into one Edge secret (GROQ_KEYS_POOL) to stay under the 100-secret limit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.local}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-emviaygygylosvmtsvlq}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi
POOL=""
while IFS= read -r line; do
  [[ "$line" =~ ^GROQ_API_KEY[0-9]+= ]] || continue
  val="${line#*=}"
  val="$(printf '%s' "$val" | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -n "$val" ]] || continue
  if [[ -n "$POOL" ]]; then POOL+=","; fi
  POOL+="$val"
done < <(grep -E '^GROQ_API_KEY[0-9]+=' "$ENV_FILE" | sort -t= -k1.13 -n)
if [[ -z "$POOL" ]]; then
  echo "No GROQ_API_KEYn entries in $ENV_FILE" >&2
  exit 1
fi
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
printf 'GROQ_KEYS_POOL=%s\n' "$POOL" > "$TMP"
supabase secrets set --env-file "$TMP" --project-ref "$PROJECT_REF" --yes
KEY_COUNT=$(( $(grep -o ',' <<<"$POOL" | wc -l | tr -d ' ') + 1 ))
echo "Pushed GROQ_KEYS_POOL with ${KEY_COUNT} Groq key(s) in one secret."

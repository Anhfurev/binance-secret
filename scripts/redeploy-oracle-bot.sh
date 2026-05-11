#!/usr/bin/env bash
set -euo pipefail

# Fast redeploy only:
# - rsync code
# - deno cache
# - pm2 restart (or start if missing)
#
# No install checks by design.

REMOTE_HOST="${REMOTE_HOST:-64.110.105.147}"
REMOTE_USER="${REMOTE_USER:-opc}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_DIR="${REMOTE_DIR:-~/binance-bot}"
ENTRY_FILE="${ENTRY_FILE:-index.ts}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

echo "==> Fast sync to ${REMOTE}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude ".next" \
  --exclude "dist" \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  ./ "${REMOTE}:${REMOTE_DIR}/"

echo "==> Fast restart with PM2"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${REMOTE}" \
  "REMOTE_DIR='${REMOTE_DIR}' ENTRY_FILE='${ENTRY_FILE}' bash -s" <<'EOF'
set -euo pipefail
eval "REMOTE_DIR_EXPANDED=${REMOTE_DIR}"
cd "${REMOTE_DIR_EXPANDED}"

if [ ! -f "${ENTRY_FILE}" ]; then
  if [ -f "main.ts" ]; then
    ENTRY_FILE="main.ts"
  elif [ -f "index.ts" ]; then
    ENTRY_FILE="index.ts"
  else
    echo "No entrypoint found for redeploy." >&2
    exit 1
  fi
fi

export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:/usr/local/bin:/usr/bin:$PATH"

deno cache "${ENTRY_FILE}"

if pm2 describe binance-bot >/dev/null 2>&1; then
  pm2 restart binance-bot --update-env
else
  pm2 start "deno run --allow-net --allow-env --allow-read ${ENTRY_FILE}" --name binance-bot
fi

pm2 save
pm2 status
EOF

echo "==> Redeploy complete"

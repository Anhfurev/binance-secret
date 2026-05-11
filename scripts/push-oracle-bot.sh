#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash scripts/push-oracle-bot.sh
#
# Optional env overrides:
#   REMOTE_HOST=64.110.105.147
#   REMOTE_USER=opc
#   SSH_KEY=~/Downloads/ssh-key-2026-05-06.key
#   REMOTE_DIR=~/binance-bot
#   ENTRY_FILE=index.ts   # or main.ts

REMOTE_HOST="${REMOTE_HOST:-64.110.105.147}"
REMOTE_USER="${REMOTE_USER:-opc}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_DIR="${REMOTE_DIR:-~/binance-bot}"
ENTRY_FILE="${ENTRY_FILE:-index.ts}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

echo "==> Sync project to ${REMOTE}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude ".next" \
  --exclude "dist" \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  ./ "${REMOTE}:${REMOTE_DIR}/"

echo "==> Remote setup (Deno, Node/npm, PM2, deps, PM2 start)"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${REMOTE}" "bash -s" <<'EOF'
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:-~/binance-bot}"
ENTRY_FILE="${ENTRY_FILE:-index.ts}"

# Expand ~ safely
eval "REMOTE_DIR_EXPANDED=${REMOTE_DIR}"
cd "${REMOTE_DIR_EXPANDED}"

if ! command -v deno >/dev/null 2>&1; then
  echo "Installing Deno..."
  curl -fsSL https://deno.land/install.sh | sh
  if ! grep -q 'DENO_INSTALL' "$HOME/.bashrc"; then
    echo 'export DENO_INSTALL="$HOME/.deno"' >> "$HOME/.bashrc"
    echo 'export PATH="$DENO_INSTALL/bin:$PATH"' >> "$HOME/.bashrc"
  fi
  export DENO_INSTALL="$HOME/.deno"
  export PATH="$DENO_INSTALL/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js and npm..."
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y nodejs npm
  else
    echo "Unsupported package manager. Install Node.js manually." >&2
    exit 1
  fi
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing PM2..."
  sudo npm install -g pm2
  hash -r 2>/dev/null || true
  export PATH="/usr/local/bin:/usr/bin:$PATH"
fi

if [ ! -f "${ENTRY_FILE}" ]; then
  if [ -f "main.ts" ]; then
    ENTRY_FILE="main.ts"
  elif [ -f "index.ts" ]; then
    ENTRY_FILE="index.ts"
  else
    echo "No entrypoint found. Set ENTRY_FILE to main.ts or index.ts." >&2
    exit 1
  fi
fi

echo "Caching Deno dependencies..."
deno cache "${ENTRY_FILE}"

echo "Starting/updating PM2 process..."
pm2 delete binance-bot >/dev/null 2>&1 || true
pm2 start "deno run --allow-net --allow-env --allow-read ${ENTRY_FILE}" --name binance-bot

echo "Saving PM2 process list..."
pm2 save

echo "Enabling PM2 startup on boot..."
sudo env PATH="$PATH" PM2_HOME="$HOME/.pm2" \
  "$(command -v pm2)" startup systemd -u "$(whoami)" --hp "$HOME"

pm2 save
pm2 status
EOF

echo "==> Done"
echo "Tail logs:"
echo "ssh -i ${SSH_KEY} ${REMOTE} 'pm2 logs binance-bot --lines 200'"

#!/usr/bin/env bash
# Run on your MacBook. Uploads the project via scp (archive) and expands on the server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_USER="${REMOTE_USER:-opc}"
REMOTE_HOST="${REMOTE_HOST:-64.110.105.147}"
REMOTE_DIR="${REMOTE_DIR:-binance-bot}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
ARCHIVE_NAME="bot-deploy.tgz"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

[[ -f "$SSH_KEY" ]] || die "SSH key missing: $SSH_KEY (chmod 600 recommended)"
chmod 600 "$SSH_KEY" 2>/dev/null || true

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ARCHIVE="$TMP/$ARCHIVE_NAME"
echo "Creating archive from $ROOT ..."
tar czf "$ARCHIVE" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='out' \
  --exclude='dist' \
  --exclude='.turbo' \
  --exclude='coverage' \
  --exclude='*.log' \
  -C "$ROOT" .

echo "Uploading with scp ..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$ARCHIVE" "${REMOTE}:~/"

echo "Extracting into ~/$REMOTE_DIR on server ..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$REMOTE" \
  "mkdir -p ~/${REMOTE_DIR} && tar xzf ~/${ARCHIVE_NAME} -C ~/${REMOTE_DIR} && rm -f ~/${ARCHIVE_NAME}"

echo "Done. Code is at ~/${REMOTE_DIR} on ${REMOTE_HOST}."
echo "Ensure main.ts exists there (your Deno entry). Restart bot: ssh ... 'cd ~/${REMOTE_DIR} && pm2 restart binance-bot'"

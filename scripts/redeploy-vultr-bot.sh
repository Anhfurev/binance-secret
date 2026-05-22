#!/usr/bin/env bash
# Mac → Vultr: rsync repo + restart PM2 Deno bot (supabase/functions/binance-bot), not Edge deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/.oracle-gateway.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

REMOTE_HOST="${REMOTE_HOST:-45.76.115.143}"
REMOTE_USER="${REMOTE_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-05-06.key}"
REMOTE_DIR="${REMOTE_DIR:-/root/binance-bot}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[[ -f "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")

echo "==> Rsync to ${REMOTE}:${REMOTE_DIR}"
rsync -az \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".next" \
  --exclude ".env" \
  --exclude ".env.*" \
  -e "ssh ${SSH_OPTS[*]}" \
  "${ROOT}/" "${REMOTE}:${REMOTE_DIR}/"

echo "==> PM2: binance-bot (Deno :8788) + app + ws-daemon"
ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -s" <<EOF
set -euo pipefail
cd "${REMOTE_DIR}"
export DENO_INSTALL="\${DENO_INSTALL:-\$HOME/.deno}"
export PATH="\$DENO_INSTALL/bin:/usr/local/bin:/usr/bin:\$PATH"
command -v deno >/dev/null || curl -fsSL https://deno.land/install.sh | sh
deno cache --config supabase/functions/binance-bot/deno.json supabase/functions/binance-bot/index.ts
chmod +x scripts/vultr-bot-cron.sh scripts/fix-vultr-stream-hub-deno.sh 2>/dev/null || true
if [[ -f .env ]]; then set -a; source .env; set +a; fi
export BOT_HTTP_PORT=8788
export BINANCE_BOT_WAKE_URL=http://127.0.0.1:8788
pm2 delete binance-bot 2>/dev/null || true
pm2 start ecosystem.vultr.config.cjs --only binance-bot --update-env || pm2 restart binance-bot --update-env
pm2 restart binance-app binance-ws-daemon --update-env 2>/dev/null || true
pm2 save
pm2 status
curl -fsS --max-time 3 http://127.0.0.1:8788/ -X OPTIONS >/dev/null 2>&1 && echo "bot HTTP ok" || echo "WARN: bot not responding on :8788 yet"
EOF

echo "==> Stream hub: 10 symbols + wake local bot"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "BOT_WAKE_SECRET='${BOT_WAKE_SECRET:-${BOT_SECRET:-}}' BINANCE_BOT_WAKE_URL='http://127.0.0.1:8788' bash ${REMOTE_DIR}/scripts/fix-vultr-stream-hub-deno.sh" \
  2>/dev/null || echo "WARN: stream hub script skipped (run manually on VPS)"

echo "==> Done. On VPS add cron:"
echo "  * * * * * ${REMOTE_DIR}/scripts/vultr-bot-cron.sh >> /var/log/vultr-bot-cron.log 2>&1"
echo "Disable Supabase pg_cron heartbeat if you no longer want Edge (Dashboard → Database → Cron)."

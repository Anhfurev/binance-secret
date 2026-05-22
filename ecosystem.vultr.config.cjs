/**
 * PM2 on Vultr gateway — Deno bot (not Supabase Edge).
 *   pm2 start ecosystem.vultr.config.cjs && pm2 save
 */
const path = require("path");

const appDir = process.env.BINANCE_APP_DIR || path.join(__dirname);
const deno =
  process.env.DENO_BIN ||
  path.join(process.env.HOME || "/root", ".deno/bin/deno");
const botEntry = path.join(
  appDir,
  "supabase/functions/binance-bot/index.ts",
);

module.exports = {
  apps: [
    {
      name: "binance-bot",
      cwd: appDir,
      script: botEntry,
      interpreter: deno,
      interpreter_args:
        "run --allow-net --allow-env --allow-read --config supabase/functions/binance-bot/deno.json",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
      env: {
        BOT_HTTP_PORT: "8788",
        BINANCE_BOT_WAKE_URL: "http://127.0.0.1:8788",
        TELEGRAM_CRON_DIGEST: "1",
        TELEGRAM_CRON_DIGEST_MS: "120000",
      },
    },
    {
      name: "binance-app",
      cwd: appDir,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "binance-ws-daemon",
      cwd: appDir,
      script: "node_modules/.bin/tsx",
      args: "scripts/binance-websocket-daemon.ts",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      env: { NODE_ENV: "production" },
    },
  ],
};

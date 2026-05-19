/**
 * PM2 production config for Next.js (no Node inspector).
 * Usage on VPS: pm2 start ecosystem.next.config.cjs && pm2 save
 */
const path = require("path");

const appDir = process.env.BINANCE_APP_DIR || path.join(__dirname);

module.exports = {
  apps: [
    {
      name: "binance-app",
      cwd: appDir,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
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
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

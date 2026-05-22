# Vultr bot (not Supabase Edge)

## Layout

| Piece | Where |
|--------|--------|
| **Trading bot** | Vultr — `deno` + PM2 `binance-bot` → `supabase/functions/binance-bot/index.ts` on **:8788** |
| **Next UI** | Vultr — PM2 `binance-app` :3000 |
| **Binance REST** | Vultr gateway nginx → `api.binance.com` (IP whitelist) |
| **Stream hub** | Vultr — `binance-stream-hub` :8787, wicks wake **local** bot |
| **Postgres** | Supabase — `bot_settings`, `trades`, secrets |

## Deploy from Mac

```bash
bash scripts/redeploy-vultr-bot.sh
```

Requires `scripts/.oracle-gateway.env` (or env): `REMOTE_HOST`, `SSH_KEY`, `BOT_SECRET`, Supabase keys in VPS `.env`.

## Cron on Vultr (10 symbols)

```bash
chmod +x /root/binance-bot/scripts/vultr-bot-cron.sh
crontab -e
# Bot scan every minute; Telegram digest every 2 min (TELEGRAM_CRON_DIGEST_MS in .env):
# * * * * * /root/binance-bot/scripts/vultr-bot-cron.sh >> /var/log/vultr-bot-cron.log 2>&1
```

In `/root/binance-bot/.env`:

```bash
TELEGRAM_CRON_DIGEST=1
TELEGRAM_CRON_DIGEST_MS=120000
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Then `pm2 restart binance-bot --update-env`.

Loads symbols from `bot_settings` where `is_autopilot_enabled = true` (all 10).

## SQL migration `20260522140000_heartbeat_all_autopilot_symbols.sql`

- **Only if** you still use **Supabase pg_cron** calling HTTP.
- It does **not** hardcode 3 coins — it `jsonb_agg`s every autopilot symbol.
- If the bot runs on **Vultr**, either point `v_url` in that function to `http://<your-vps>:8788` or **disable** job `bot-heartbeat-all-symbols` and use `vultr-bot-cron.sh` instead.

## Env on VPS `.env`

- `BOT_HTTP_PORT=8788`
- `BINANCE_BOT_WAKE_URL=http://127.0.0.1:8788`
- `BOT_SECRET` / `BOT_WAKE_SECRET` — same value
- `BINANCE_REST_GATEWAY_URL`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_GATEWAY_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Do **not** set `IS_PAPER_TRADING=1` for real spot

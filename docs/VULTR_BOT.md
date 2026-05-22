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

PM2 does **not** read `.env` by itself. Use `scripts/vultr-deno-bot.sh` (via `ecosystem.vultr.config.cjs`) so token/chat load on start.

```bash
chmod +x scripts/vultr-deno-bot.sh scripts/vultr-test-telegram.sh
pm2 delete binance-bot
pm2 start ecosystem.vultr.config.cjs --only binance-bot
pm2 save
bash scripts/vultr-test-telegram.sh
```

Test message should appear in Telegram immediately. Cron digest every 2 min after that.

Loads symbols from `bot_settings` where `is_autopilot_enabled = true` (all 10).

## SQL migration `20260522140000_heartbeat_all_autopilot_symbols.sql`

- **Only if** you still use **Supabase pg_cron** calling HTTP.
- It does **not** hardcode 3 coins — it `jsonb_agg`s every autopilot symbol.
- If the bot runs on **Vultr**, either point `v_url` in that function to `http://<your-vps>:8788` or **disable** job `bot-heartbeat-all-symbols` and use `vultr-bot-cron.sh` instead.

## Binance gateway (IP whitelist)

Your Binance key only allows the **Vultr public IP**. Every signed REST call must use the gateway, not `https://api.binance.com` directly.

On `/root/binance-bot/.env`:

```bash
BINANCE_REST_GATEWAY_URL=http://45.76.115.143
BINANCE_GATEWAY_SECRET=<same value configured in nginx on this VM>
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
```

- No trailing slash on the gateway URL.
- `BINANCE_GATEWAY_SECRET` must match `scripts/vultr-stable-gateway-setup.sh` / nginx `X-Binance-Gateway-Secret`.
- Bot + Next app on the **same** VPS still use this URL (Binance sees egress IP `45.76.115.143`).

Test from the VPS:

```bash
bash scripts/vultr-gateway-test.sh
```

Expect `HTTP 200` and account JSON. If `401` / `-2015`, fix API key IP list or secret mismatch.

## Debugger `MISSING_REQUIRED_ENV` / `ERRORS_RECENT`

Run on VPS:

```bash
bash scripts/vultr-env-check-debugger.sh
```

Every line must be `OK`. Common fixes:

| MISS | Add to `.env` |
|------|----------------|
| `SUPABASE_URL` | `SUPABASE_URL=` or `NEXT_PUBLIC_SUPABASE_URL=https://….supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | same name or `DB_SERVICE_ROLE_KEY` |
| `BOT_SECRET` | `BOT_SECRET=` (same as cron header) |
| `GEMINI_API_KEY` | copy from Mac `.env.local` |
| `TELEGRAM_*` | token + chat id |

`ERRORS_RECENT` warn = old errors in DB (e.g. FAPI `-2015`). After `FAST_BOUNCE_FUTURES_LANE=0` + `git pull`, it clears as new cycles succeed.

## Env on VPS `.env`

- `BOT_HTTP_PORT=8788`
- `BINANCE_BOT_WAKE_URL=http://127.0.0.1:8788` (local Deno bot only — not Binance)
- `BOT_SECRET` / `BOT_WAKE_SECRET` — same value
- `BINANCE_REST_GATEWAY_URL=http://45.76.115.143` (your gateway — **not** `127.0.0.1` unless you know nginx answers there)
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Do **not** set `IS_PAPER_TRADING=1` for real spot
- `FAST_BOUNCE_FUTURES_LANE=0` (optional; auto-off when `BINANCE_REST_GATEWAY_URL` is set). Futures uses `fapi.binance.com` directly and will fail `-2015` on IP-restricted spot keys.

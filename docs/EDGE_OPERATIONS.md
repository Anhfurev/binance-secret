# Edge bot operations

Short runbook for `binance-bot` (Supabase Edge Function). Secrets stay in Supabase project env — never commit `BOT_SECRET`, API keys, or service role keys.

## Cron overlap and global timeout

- A second cron invocation while a cycle is still running returns `skipped: true` with `reason: previous_cycle_in_flight` until the global timeout elapses.
- `Promise.race` against the global timeout returns `edge_global_timeout_guard` to the caller; work may still finish in the background. Check function logs and `logs` for `late_completion_after_timeout` if you suspect a race.

## Trade execution locks (`trade_execution_locks`)

- One row per `(bot_id, cycle_id, side)` blocks duplicate `createOrder` in the same cycle before a `trades` row exists.
- Stale rows are pruned on claim (throttled). Tune on the function:
  - `TRADE_EXEC_LOCK_STALE_MS` (default 180000)
  - `TRADE_EXEC_LOCK_PRUNE_MIN_INTERVAL_MS` (default 60000)
  - `TRADE_EXEC_LOCK_DISABLE=1` disables locks (emergency only)
- RLS is enabled with no policies for `anon` / `authenticated`; the Edge function uses **service role** (bypasses RLS). Do not expose service role to the browser.
- If locks look stuck: confirm `releaseTradeExecutionLock` ran after buy/sell persistence; prune manually with `DELETE FROM trade_execution_locks WHERE created_at < now() - interval '5 minutes'` if needed.

## Paper vs live

- Paper/ghost: `createOrder` with `isTestMode` uses `fetchPublicSpotTicker` (REST `bookTicker`, honors `AbortSignal`) and `simulatePaperFill` — not live CCXT orders.
- Live: `executeSmartLimitChaser` + egress IP guard. Flipping `is_live_trading_enabled` changes routing only; paper fills are modeled for comparable PnL.
- **Oracle static IP (optional):** run `scripts/oracle-stable-gateway-setup.sh` on the VM (nginx → `api.binance.com`, header `X-Binance-Gateway-Secret`). On Edge set `BINANCE_REST_GATEWAY_URL=http://<VM_PUBLIC_IP>` and the same `BINANCE_GATEWAY_SECRET`. Allowlist that IP on the Binance API key. When the gateway is set, Edge skips `BINANCE_REQUIRED_EGRESS_IP` (Binance sees the VM egress IP).
- Exits use DB `take_profit_pct` / per-trade `stopLoss` — not a hardcoded ROI shortcut.

## Observability

- Set `EXEC_OBSERVE=1` on the function for one-line JSON logs: lock claim/release/prune, public ticker null, sell fill qty mismatch, create-order idempotent skips.
- `execution-quality` rows in `logs`: `buy_fill_quality`, `sell_fill_quality`.
- `VERBOSE_DB_LOGS=1` increases `public.logs` volume; default is lean.

## Local checks

```bash
npm run check
```

Runs ESLint, `tsc --noEmit`, and Deno unit tests under `supabase/functions/binance-bot/tests`.

## Deploy

Deploy `binance-bot` with JWT verification off for cron (`--no-verify-jwt` per project convention). Apply new migrations before relying on lock RLS changes.

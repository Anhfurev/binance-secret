# Database current state — `bot_settings` & `trades`

This document reflects the **schema defined in the repository** (`supabase/setup-trading-schema.sql`) plus **columns the application and Edge Functions read/write** that are not all present in that single setup script. It is **not** a live `pg_dump` or `information_schema` export (that would require a connected Supabase/Postgres instance).

---

## Checks (from `/test`)

| Command | Result |
|--------|--------|
| `npm run lint` | Pass |
| `npx tsc --noEmit` | Fail (existing repo issues, e.g. `balance-provider.tsx`, `lib/signals-data.ts`, `lib/supabase-demo.ts`, `lib/supabase.ts`, `lib/trading/demo-logic.ts`) |
| `npm test` / `jest` | **No test script** in `package.json` |

---

## `public.bot_settings`

### Canonical DDL (repo)

Defined in `supabase/setup-trading-schema.sql`:

| Column | Type | Nullable / default |
|--------|------|-------------------|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| `is_autopilot_enabled` | `boolean` | NOT NULL, default `false` |
| `symbol` | `text` | NOT NULL, default `'BTCUSDT'` |
| `risk_percent` | `numeric(10, 4)` | nullable |
| `trade_size_usd` | `numeric(18, 2)` | nullable |
| `fixed_trade_usd` | `numeric(18, 2)` | nullable |
| `rsi_buy_threshold` | `numeric(10, 2)` | nullable |
| `rsi_sell_threshold` | `numeric(10, 2)` | nullable |
| `stop_loss_pct` | `numeric(10, 2)` | nullable |
| `take_profit_pct` | `numeric(10, 2)` | nullable |
| `trailing_stop_pct` | `numeric(10, 2)` | nullable, default `0.01` (after alter) |
| `model_status` | `text` | nullable |
| `model_status_until` | `timestamptz` | nullable |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |

**Index:** `idx_bot_settings_user_updated_at` on `(user_id, updated_at desc)`.

### Also used in code (ensure these exist in your deployed DB)

These appear in `app/api/bot-settings/route.ts`, `supabase/functions/binance-bot/types.ts`, and bot handlers but are **not** in the `CREATE TABLE` block above:

- `is_live_trading_enabled` (`boolean`)
- `is_aggressive_mode` (`boolean`)
- `min_ai_confidence` (numeric; clamped in bot)
- `max_open_trades` (integer)
- `min_profit_after_fees_pct` (`numeric(10,4)`): minimum net TP % after estimated 2×taker fees before BUY; `0` disables; `NULL` uses Edge default (`DEFAULT_MIN_PROFIT_AFTER_FEES_PCT`, typically `0.15`). Migration `20260510180000_bot_settings_min_profit_after_fees.sql`.

**Edge (optional, `binance-bot`):** `TRADINGVIEW_WEBHOOK_SECRET` — TradingView alert auth with `tv_webhook` + `tv_secret` (see `index.ts`). `LLM_MAX_CONCURRENT` — cap parallel Gemini/Groq calls (default 2).

**DB (`trade_execution_locks`):** migration `20260517120000_trade_execution_locks.sql` — unique `(bot_id, cycle_id, side)` prevents duplicate `createOrder` when Edge retries before a `trades` row exists. Stale rows: `TRADE_EXEC_LOCK_STALE_MS` (default 180000); disable with `TRADE_EXEC_LOCK_DISABLE=1`.

The API **upserts** with `onConflict: "user_id,symbol"`, which implies a **unique constraint on `(user_id, symbol)`** in the database you run against. That constraint is not created in `setup-trading-schema.sql` as checked into this repo—add it if upserts should match production.

### Example row (JSON)

Illustrative shape (IDs are fake):

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "user_id": "11111111-2222-3333-4444-555555555555",
  "is_autopilot_enabled": true,
  "is_live_trading_enabled": false,
  "is_aggressive_mode": false,
  "symbol": "BTCUSDT",
  "risk_percent": 1.0,
  "trade_size_usd": 50.0,
  "fixed_trade_usd": null,
  "rsi_buy_threshold": 35.0,
  "rsi_sell_threshold": 65.0,
  "stop_loss_pct": 2.0,
  "take_profit_pct": 4.0,
  "trailing_stop_pct": 0.01,
  "min_ai_confidence": 55,
  "max_open_trades": 3,
  "model_status": "ok",
  "model_status_until": null,
  "created_at": "2026-04-27T12:00:00.000Z",
  "updated_at": "2026-04-27T12:00:00.000Z"
}
```

---

## `public.trades`

### Canonical DDL (repo)

Defined in `supabase/setup-trading-schema.sql`:

| Column | Type | Nullable / default |
|--------|------|-------------------|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| `signalId` | `text` | nullable (quoted identifier in SQL) |
| `exchange_order_id` | `text` | nullable |
| `coinId` | `text` | nullable (quoted identifier in SQL) |
| `symbol` | `text` | nullable in alter path; app uses NOT NULL |
| `type` | `text` | nullable in alter path; app uses NOT NULL |
| `entryPrice` | `numeric(20, 8)` | nullable |
| `exitPrice` | `numeric(20, 8)` | nullable |
| `amount` | `numeric(28, 12)` | nullable |
| `value` | `numeric(20, 8)` | nullable |
| `status` | `text` | NOT NULL, default `'open'` |
| `pnl` | `numeric(20, 8)` | nullable |
| `pnlPercent` | `numeric(10, 4)` | nullable |
| `opened_at` | `timestamptz` | NOT NULL, default `now()` |
| `closed_at` | `timestamptz` | nullable |
| `stopLoss` | `numeric(20, 8)` | nullable |
| `takeProfit` | `numeric(20, 8)` | nullable |
| `followedSignal` | `boolean` | NOT NULL, default `true` |
| `exit_reason` | `text` | nullable |
| `notes` | `text` | nullable |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

**Indexes:** `idx_trades_user_opened_at`, `idx_trades_user_status`, `idx_trades_user_symbol_status`.

**RLS:** enabled; policies for authenticated users to select/insert/update own rows (`auth.uid() = user_id`).

**Trigger:** `trg_trades_set_updated_at` sets `updated_at` on update.

### Also used in code (ensure these exist in your deployed DB)

Edge Function `trade-store.ts` and buys/sells assume at least:

- `price` — non-null numeric in production paths (`insertTrade` resolves it from `price` / `entryPrice` / `exitPrice` / `extra.*`).
- `extra` — `jsonb` (or JSON-compatible) for trailing stop, idempotency (`bot_id`, `idempotency_ts`), paper/live flags, etc. Queried in `binance.ts` as `extra->>bot_id`, `extra->>idempotency_ts`.

`lib/services/execution/execution-helpers.ts` may insert optional fields such as `executionNotes`, `binance_order_id`, `fill_price`, `risk_percent`, `exchange`—your DB needs matching columns if you rely on the “rich” insert path.

### Example row — open BUY (JSON)

PostgREST/JS often returns camelCase for quoted columns; example aligned with bot insert shape:

```json
{
  "id": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
  "user_id": "11111111-2222-3333-4444-555555555555",
  "signalId": "edge-buy-1714234567890",
  "exchange_order_id": "paper-12345",
  "coinId": "btc",
  "symbol": "BTCUSDT",
  "type": "buy",
  "price": 95000.12345678,
  "entryPrice": 95000.12345678,
  "exitPrice": null,
  "amount": 0.00021052,
  "value": 20.0,
  "status": "open",
  "pnl": null,
  "pnlPercent": null,
  "opened_at": "2026-04-27T12:05:00.000Z",
  "closed_at": null,
  "stopLoss": 93100.12111111,
  "takeProfit": 98800.12580222,
  "followedSignal": true,
  "exit_reason": null,
  "notes": "Edge BUY | orderId=paper-12345 | strategy=... | tech=BUY ai=bullish(72)",
  "extra": {
    "bot_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "idempotency_ts": "2026-04-27T12:00:00.000Z",
    "is_paper": true,
    "trade_mode": "paper",
    "highest_price_seen": 95000.12345678,
    "highest_price_reached": 95000.12345678,
    "trailing_stop_price": 94050.0,
    "trailing_stop_pct": 0.01
  },
  "created_at": "2026-04-27T12:05:00.000Z",
  "updated_at": "2026-04-27T12:05:00.000Z"
}
```

### Example row — closed SELL / manual close (JSON)

```json
{
  "id": "cccccccc-dddd-eeee-ffff-000000000001",
  "user_id": "11111111-2222-3333-4444-555555555555",
  "signalId": "manual-sell-1714234999999",
  "exchange_order_id": null,
  "coinId": "pepe",
  "symbol": "PEPEUSDT",
  "type": "sell",
  "price": 0.00001234,
  "entryPrice": 0.00001100,
  "exitPrice": 0.00001234,
  "amount": 1000000,
  "value": 11.0,
  "status": "closed",
  "pnl": 1.34,
  "pnlPercent": 12.1818,
  "opened_at": "2026-04-26T10:00:00.000Z",
  "closed_at": "2026-04-27T14:00:00.000Z",
  "stopLoss": null,
  "takeProfit": null,
  "followedSignal": true,
  "exit_reason": "signal_exit",
  "notes": "Manual SELL from demo dashboard",
  "extra": {
    "is_paper": true,
    "trade_mode": "paper",
    "manual_close": true
  },
  "created_at": "2026-04-26T10:00:00.000Z",
  "updated_at": "2026-04-27T14:00:00.000Z"
}
```

---

## Related migration (data only)

`supabase/migrations/20260427120000_enable_autopilot_all_bot_settings.sql` runs:

```sql
update public.bot_settings
set is_autopilot_enabled = true, updated_at = now();
```

---

## Refreshing this doc from a live database

To replace this with an authoritative dump, run against your project DB (examples):

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('bot_settings', 'trades')
order by table_name, ordinal_position;

select * from public.bot_settings limit 2;
select * from public.trades order by opened_at desc limit 2;
```

Paste results here or pipe to a file and commit.

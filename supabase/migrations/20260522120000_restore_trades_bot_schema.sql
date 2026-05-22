-- Restore bot-compatible trades columns after paper_schema_unified simplified the table.
-- Rollback: drop added columns only if no bot rows depend on them (backup first).

alter table public.trades
  add column if not exists "signalId" text,
  add column if not exists exchange_order_id text,
  add column if not exists "coinId" text,
  add column if not exists type text,
  add column if not exists "entryPrice" numeric(20, 8),
  add column if not exists "exitPrice" numeric(20, 8),
  add column if not exists amount numeric(28, 12),
  add column if not exists value numeric(20, 8),
  add column if not exists status text,
  add column if not exists pnl numeric(20, 8),
  add column if not exists "pnlPercent" numeric(10, 4),
  add column if not exists opened_at timestamptz,
  add column if not exists "stopLoss" numeric(20, 8),
  add column if not exists "takeProfit" numeric(20, 8),
  add column if not exists "followedSignal" boolean default true,
  add column if not exists exit_reason text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists price numeric(20, 8),
  add column if not exists extra jsonb default '{}'::jsonb,
  add column if not exists ai_reasoning text;

-- Backfill from paper-schema snake_case columns where present.
update public.trades
set
  type = coalesce(type, side, 'BUY'),
  "entryPrice" = coalesce("entryPrice", entry_price),
  "exitPrice" = coalesce("exitPrice", exit_price),
  amount = coalesce(amount, qty),
  pnl = coalesce(pnl, net_pnl, raw_pnl),
  status = coalesce(status, case when closed_at is not null then 'closed' else 'open' end),
  opened_at = coalesce(opened_at, closed_at, now()),
  created_at = coalesce(created_at, closed_at, now()),
  updated_at = coalesce(updated_at, closed_at, now()),
  price = coalesce(price, "entryPrice", entry_price, exit_price),
  extra = coalesce(extra, '{}'::jsonb),
  "followedSignal" = coalesce("followedSignal", true)
where
  type is null
  or "entryPrice" is null
  or status is null
  or opened_at is null
  or price is null
  or extra is null;

create index if not exists idx_trades_user_status
  on public.trades (user_id, status);

create index if not exists idx_trades_user_symbol_status
  on public.trades (user_id, symbol, status);

create index if not exists idx_trades_user_opened_at
  on public.trades (user_id, opened_at desc);

create index if not exists idx_trades_open_live_lookup
  on public.trades (user_id, symbol, opened_at desc)
  where status ilike 'open'
    and (extra->>'is_ghost' is null or extra->>'is_ghost' = 'false')
    and (
      extra->>'trade_mode' is null
      or extra->>'trade_mode' in ('live', 'paper')
    );

create index if not exists idx_trades_open_bot_id_lookup
  on public.trades (user_id, symbol, ((extra->>'bot_id')), opened_at desc)
  where status ilike 'open'
    and (extra->>'bot_id') is not null;

comment on column public.trades.extra is
  'Bot metadata: bot_id, trade_mode (paper/live/ghost), trailing stops, idempotency keys.';

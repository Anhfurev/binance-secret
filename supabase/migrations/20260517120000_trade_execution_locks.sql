-- Prevents duplicate BUY/SELL submissions when Edge/cron retries overlap the same
-- (bot_id, cycle_id, side) before a `trades` row exists. Service-role Edge inserts/deletes.

create table if not exists public.trade_execution_locks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  bot_id uuid not null,
  cycle_id text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists trade_execution_locks_bot_cycle_side_uidx
  on public.trade_execution_locks (bot_id, cycle_id, side);

comment on table public.trade_execution_locks is
  'Short-lived claim before CCXT/paper createOrder; unique (bot_id,cycle_id,side) blocks double-submit. Stale rows removed by Edge after failed orders or TTL.';

create index if not exists trade_execution_locks_created_at_idx
  on public.trade_execution_locks (created_at);

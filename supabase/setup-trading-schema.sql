-- =============================================================================
-- Supabase Trading Storage Setup
-- Run this in Supabase SQL Editor.
-- Safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- profiles: cloud-persisted paper account balances
-- -----------------------------------------------------------------------------
alter table if exists public.profiles
  add column if not exists demo_balance numeric(18, 2),
  add column if not exists starting_balance numeric(18, 2),
  add column if not exists global_stop boolean not null default false;

update public.profiles
set
  demo_balance = coalesce(demo_balance, 10000),
  starting_balance = coalesce(starting_balance, demo_balance, 10000)
where demo_balance is null or starting_balance is null;

alter table if exists public.profiles
  alter column demo_balance set default 10000,
  alter column starting_balance set default 10000;

-- -----------------------------------------------------------------------------
-- trades: normalized history table (keeps your existing table, fills gaps)
-- -----------------------------------------------------------------------------
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  "signalId" text,
  exchange_order_id text,
  "coinId" text,
  symbol text not null,
  type text not null,
  "entryPrice" numeric(20, 8),
  "exitPrice" numeric(20, 8),
  amount numeric(28, 12),
  value numeric(20, 8),
  status text not null default 'open',
  pnl numeric(20, 8),
  "pnlPercent" numeric(10, 4),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  "stopLoss" numeric(20, 8),
  "takeProfit" numeric(20, 8),
  "followedSignal" boolean not null default true,
  exit_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.trades
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists "signalId" text,
  add column if not exists exchange_order_id text,
  add column if not exists "coinId" text,
  add column if not exists symbol text,
  add column if not exists type text,
  add column if not exists "entryPrice" numeric(20, 8),
  add column if not exists "exitPrice" numeric(20, 8),
  add column if not exists amount numeric(28, 12),
  add column if not exists value numeric(20, 8),
  add column if not exists status text,
  add column if not exists pnl numeric(20, 8),
  add column if not exists "pnlPercent" numeric(10, 4),
  add column if not exists opened_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists "stopLoss" numeric(20, 8),
  add column if not exists "takeProfit" numeric(20, 8),
  add column if not exists "followedSignal" boolean,
  add column if not exists exit_reason text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.trades
set
  status = coalesce(status, 'open'),
  "followedSignal" = coalesce("followedSignal", true),
  opened_at = coalesce(opened_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  status is null
  or "followedSignal" is null
  or opened_at is null
  or created_at is null
  or updated_at is null;

create index if not exists idx_trades_user_opened_at
  on public.trades (user_id, opened_at desc);

create index if not exists idx_trades_user_status
  on public.trades (user_id, status);

create index if not exists idx_trades_user_symbol_status
  on public.trades (user_id, symbol, status);

create or replace function public.set_updated_at_now()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_trades_set_updated_at on public.trades;
create trigger trg_trades_set_updated_at
before update on public.trades
for each row execute function public.set_updated_at_now();

-- -----------------------------------------------------------------------------
-- bot_settings: per-user autopilot configuration
-- -----------------------------------------------------------------------------
create table if not exists public.bot_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  is_autopilot_enabled boolean not null default false,
  symbol text not null default 'BTCUSDT',
  risk_percent numeric(10, 4),
  trade_size_usd numeric(18, 2),
  fixed_trade_usd numeric(18, 2),
  rsi_buy_threshold numeric(10, 2),
  rsi_sell_threshold numeric(10, 2),
  stop_loss_pct numeric(10, 2),
  take_profit_pct numeric(10, 2),
  trailing_stop_pct numeric(10, 2),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table if exists public.bot_settings
  add column if not exists trailing_stop_pct numeric(10, 2),
  add column if not exists model_status text,
  add column if not exists model_status_until timestamptz;

alter table if exists public.bot_settings
  alter column trailing_stop_pct set default 0.01;

create index if not exists idx_bot_settings_user_updated_at
  on public.bot_settings (user_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.trades enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trades'
      and policyname = 'Users can read own trades'
  ) then
    create policy "Users can read own trades"
      on public.trades
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trades'
      and policyname = 'Users can insert own trades'
  ) then
    create policy "Users can insert own trades"
      on public.trades
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trades'
      and policyname = 'Users can update own trades'
  ) then
    create policy "Users can update own trades"
      on public.trades
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- bot_performance: per-bot performance stats
-- -----------------------------------------------------------------------------
create table if not exists public.bot_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  total_trades integer not null default 0,
  win_count integer not null default 0,
  loss_count integer not null default 0,
  total_pnl_usd numeric(18, 2) not null default 0,
  win_rate_pct numeric(6, 2) not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
);

-- -----------------------------------------------------------------------------
-- ai_cache + logs: AI runtime cache + observability
-- -----------------------------------------------------------------------------
create table if not exists public.ai_cache (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  confidence numeric(10, 2) not null,
  trend text not null,
  action text,
  trend_alignment boolean,
  created_at timestamptz not null default now()
);

alter table if exists public.ai_cache
  add column if not exists action text,
  add column if not exists trend_alignment boolean;

create index if not exists idx_ai_cache_symbol_created_at
  on public.ai_cache (symbol, created_at desc);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  symbol text,
  level text,
  source text,
  message text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_logs_created_at
  on public.logs (created_at desc);

create index if not exists idx_logs_source_created_at
  on public.logs (source, created_at desc);


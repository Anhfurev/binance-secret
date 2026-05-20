-- Unified paper trading schema (clean-slate). Rollback: restore from backup.
-- Open legs: paper_positions only. Closed legs: trades. NAV: profiles + snapshots.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  available_usdt numeric not null default 0,
  portfolio_nav_usdt numeric not null default 0,
  demo_balance numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  side text not null default 'LONG',
  entry_price numeric not null,
  qty numeric not null,
  peak_price numeric not null,
  trail_price numeric not null,
  layer integer not null default 0,
  opened_at timestamptz not null default now()
);

create index if not exists idx_paper_positions_user
  on public.paper_positions (user_id);

create table if not exists public.paper_portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  portfolio_nav_usdt numeric not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_paper_portfolio_snapshots_user_time
  on public.paper_portfolio_snapshots (user_id, recorded_at desc);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  side text not null,
  entry_price numeric not null,
  exit_price numeric not null,
  qty numeric not null,
  raw_pnl numeric not null default 0,
  fees numeric not null default 0,
  net_pnl numeric not null default 0,
  strategy_executed text,
  closed_at timestamptz not null default now()
);

create index if not exists idx_trades_user_closed
  on public.trades (user_id, closed_at desc);

alter table public.paper_positions enable row level security;
alter table public.paper_portfolio_snapshots enable row level security;

drop policy if exists paper_positions_select_own on public.paper_positions;
create policy paper_positions_select_own
  on public.paper_positions for select
  using (auth.uid() = user_id);

drop policy if exists paper_portfolio_snapshots_select_own on public.paper_portfolio_snapshots;
create policy paper_portfolio_snapshots_select_own
  on public.paper_portfolio_snapshots for select
  using (auth.uid() = user_id);

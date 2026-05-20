-- Add paper NAV columns to existing profiles (create-if-not-exists skips on live DB).
-- Rollback: alter table public.profiles drop column if exists available_usdt, drop column if exists portfolio_nav_usdt, drop column if exists demo_balance;

alter table public.profiles
  add column if not exists available_usdt numeric not null default 0,
  add column if not exists portfolio_nav_usdt numeric not null default 0,
  add column if not exists demo_balance numeric not null default 28;

comment on column public.profiles.available_usdt is 'Free USDT cash for paper/micro engine';
comment on column public.profiles.portfolio_nav_usdt is 'Total NAV (cash + open positions mark)';
comment on column public.profiles.demo_balance is 'UI demo wallet — synced with portfolio_nav_usdt';

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
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
  user_id uuid not null references public.profiles (id) on delete cascade,
  portfolio_nav_usdt numeric not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_paper_portfolio_snapshots_user_time
  on public.paper_portfolio_snapshots (user_id, recorded_at desc);

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

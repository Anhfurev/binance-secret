-- Paper scalp: durable workspace baselines + NAV snapshots (session / 24h / 7d P&L).
-- Rollback:
--   drop table if exists public.paper_portfolio_snapshots;
--   drop table if exists public.paper_workspace_baselines;

create table if not exists public.paper_workspace_baselines (
  workspace_key text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  owner_type text not null,
  owner_id text not null,
  starting_balance_usdt numeric(18, 4) not null,
  wallet_floor_usdt numeric(18, 4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_key text not null,
  owner_type text not null,
  owner_id text not null,
  recorded_at timestamptz not null default now(),
  free_cash_usdt numeric(18, 4) not null,
  open_legs_value_usdt numeric(18, 4) not null,
  total_nav_usdt numeric(18, 4) not null,
  open_leg_count int not null default 0,
  session_baseline_usdt numeric(18, 4),
  lifetime_realized_pnl_usdt numeric(18, 4),
  extra jsonb not null default '{}'::jsonb
);

create index if not exists idx_paper_portfolio_snapshots_ws_time
  on public.paper_portfolio_snapshots (workspace_key, recorded_at desc);

create index if not exists idx_paper_portfolio_snapshots_user_time
  on public.paper_portfolio_snapshots (user_id, recorded_at desc);

drop trigger if exists trg_paper_workspace_baselines_updated_at on public.paper_workspace_baselines;
create trigger trg_paper_workspace_baselines_updated_at
before update on public.paper_workspace_baselines
for each row execute function public.set_updated_at_now();

alter table public.paper_workspace_baselines enable row level security;
alter table public.paper_portfolio_snapshots enable row level security;

drop policy if exists paper_workspace_baselines_select_own on public.paper_workspace_baselines;
create policy paper_workspace_baselines_select_own
  on public.paper_workspace_baselines
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists paper_portfolio_snapshots_select_own on public.paper_portfolio_snapshots;
create policy paper_portfolio_snapshots_select_own
  on public.paper_portfolio_snapshots
  for select
  to authenticated
  using (user_id = (select auth.uid()));

comment on table public.paper_workspace_baselines is
  'Persisted paper-scalp session baseline per demo workspace (device:user or user id).';

comment on table public.paper_portfolio_snapshots is
  'NAV time series for paper workspaces — used for 24h/7d session P&L vs stored snapshots.';

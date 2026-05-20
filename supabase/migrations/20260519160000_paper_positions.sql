-- Open micro-scalp legs for trailing-stop hot path (service-role writes from Next.js).
-- Rollback: drop table if exists public.paper_positions;

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_key text not null,
  owner_type text not null,
  owner_id text not null,
  paper_leg_id text not null,
  symbol text not null,
  side text not null default 'LONG',
  entry_price numeric(20, 8) not null,
  amount numeric(28, 12) not null,
  value_usdt numeric(18, 4) not null,
  peak_price numeric(20, 8) not null,
  stop_loss numeric(20, 8) not null,
  trail_armed boolean not null default false,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  extra jsonb not null default '{}'::jsonb,
  unique (workspace_key, paper_leg_id)
);

create index if not exists idx_paper_positions_ws_open
  on public.paper_positions (workspace_key, status)
  where status = 'open';

drop trigger if exists trg_paper_positions_updated_at on public.paper_positions;
create trigger trg_paper_positions_updated_at
before update on public.paper_positions
for each row execute function public.set_updated_at_now();

alter table public.paper_positions enable row level security;

drop policy if exists paper_positions_select_own on public.paper_positions;
create policy paper_positions_select_own
  on public.paper_positions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

comment on table public.paper_positions is
  'Micro-mode open legs — trailing peaks/stops persisted for 1m execution loop.';

create table if not exists public.sunday_summaries (
  id bigserial primary key,
  week_ending_at timestamptz not null,
  total_pnl numeric(20, 8) not null default 0,
  total_trades integer not null default 0,
  star_symbol text not null default 'none',
  star_symbol_pnl numeric(20, 8) not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sunday_summaries_week_ending_at
  on public.sunday_summaries (week_ending_at desc);

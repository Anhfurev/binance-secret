-- Singleton macro + sizing knobs for fast-lane execution (no inline LLM on entry).
create table if not exists public.bot_global_settings (
  id uuid primary key default gen_random_uuid(),
  market_regime text not null default 'NEUTRAL',
  allowed_leverage integer not null default 10 check (allowed_leverage between 1 and 50),
  global_trade_multiplier numeric not null default 1.0 check (global_trade_multiplier > 0),
  updated_at timestamptz not null default now()
);

comment on table public.bot_global_settings is
  'Macro regime + futures sizing; read once per cron tick for fast math entry lane.';

insert into public.bot_global_settings (market_regime, allowed_leverage, global_trade_multiplier)
select 'NEUTRAL', 10, 1.0
where not exists (select 1 from public.bot_global_settings limit 1);

alter table public.bot_global_settings enable row level security;

revoke all on public.bot_global_settings from public;
revoke all on public.bot_global_settings from anon, authenticated;

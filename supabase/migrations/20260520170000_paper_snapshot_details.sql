-- Rich paper tick snapshots for post-trade review (what we hold, P&L, regime).
-- Rollback: alter table public.paper_portfolio_snapshots drop column if exists details,
--   drop column if exists regime_label, drop column if exists tick_summary,
--   drop column if exists open_leg_count, drop column if exists session_pnl_pct,
--   drop column if exists session_pnl_usdt, drop column if exists open_legs_value_usdt,
--   drop column if exists free_cash_usdt, drop column if exists workspace_key;

alter table public.paper_portfolio_snapshots
  add column if not exists workspace_key text,
  add column if not exists free_cash_usdt numeric(18, 4),
  add column if not exists open_legs_value_usdt numeric(18, 4),
  add column if not exists session_pnl_usdt numeric(18, 4),
  add column if not exists session_pnl_pct numeric(10, 4),
  add column if not exists open_leg_count integer not null default 0,
  add column if not exists tick_summary text,
  add column if not exists regime_label text,
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists idx_paper_portfolio_snapshots_user_ws_time
  on public.paper_portfolio_snapshots (user_id, workspace_key, recorded_at desc);

comment on column public.paper_portfolio_snapshots.details is
  'JSON: open_legs[], actions[], engine_mode, session_baseline_usdt, loss_reason hints';

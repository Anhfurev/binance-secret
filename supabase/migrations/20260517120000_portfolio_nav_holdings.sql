-- NAV / holdings for frontend (USDT cash + open token amounts).
alter table public.profiles
  add column if not exists portfolio_holdings jsonb not null default '{}'::jsonb,
  add column if not exists available_usdt numeric,
  add column if not exists portfolio_nav_usdt numeric;

comment on column public.profiles.portfolio_holdings is
  'Token balances { "USDT": { "free", "locked" }, "BTC": { ... } } synced from open trades + cash.';
comment on column public.profiles.available_usdt is
  'Free USDT cash (demo_balance / wallet) — not full NAV.';
comment on column public.profiles.portfolio_nav_usdt is
  'Last synced NAV: available USDT + sum(token qty * mark price).';

-- Rollback: alter table public.profiles drop column if exists portfolio_holdings, drop column if exists available_usdt, drop column if exists portfolio_nav_usdt;

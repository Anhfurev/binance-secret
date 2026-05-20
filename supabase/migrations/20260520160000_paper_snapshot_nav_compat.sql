-- Bridge legacy paper_portfolio_snapshots (total_nav_usdt) with slim schema (portfolio_nav_usdt).
-- Rollback: alter table public.paper_portfolio_snapshots drop column if exists portfolio_nav_usdt;

alter table public.paper_portfolio_snapshots
  add column if not exists portfolio_nav_usdt numeric(18, 4);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paper_portfolio_snapshots'
      and column_name = 'total_nav_usdt'
  ) then
    update public.paper_portfolio_snapshots
    set portfolio_nav_usdt = total_nav_usdt
    where portfolio_nav_usdt is null
      and total_nav_usdt is not null;
  end if;
end $$;

comment on column public.paper_portfolio_snapshots.portfolio_nav_usdt is
  'Total NAV USDT — preferred column for paper engine snapshots';

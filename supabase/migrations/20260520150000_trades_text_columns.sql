-- Widen legacy trades string cols (paper sync was hitting varchar(50) limits).
-- Rollback: not recommended — would re-truncate data.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'signalId'
  ) then
    execute 'alter table public.trades alter column "signalId" type text using "signalId"::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'exchange_order_id'
  ) then
    execute 'alter table public.trades alter column exchange_order_id type text using exchange_order_id::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'coinId'
  ) then
    execute 'alter table public.trades alter column "coinId" type text using "coinId"::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'symbol'
  ) then
    execute 'alter table public.trades alter column symbol type text using symbol::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'type'
  ) then
    execute 'alter table public.trades alter column type type text using type::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'status'
  ) then
    execute 'alter table public.trades alter column status type text using status::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'exit_reason'
  ) then
    execute 'alter table public.trades alter column exit_reason type text using exit_reason::text';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trades' and column_name = 'strategy_executed'
  ) then
    execute 'alter table public.trades alter column strategy_executed type text using strategy_executed::text';
  end if;
end $$;

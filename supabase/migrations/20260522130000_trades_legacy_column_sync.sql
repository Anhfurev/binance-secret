-- Sync paper-schema NOT NULL columns (side, entry_price, …) from bot insert payload (type, entryPrice, amount).
-- Rollback: drop trigger + function; optionally restore NOT NULL (only if no open bot rows).

create or replace function public.trades_sync_legacy_columns()
returns trigger
language plpgsql
as $fn$
begin
  if new.side is null or trim(new.side) = '' then
    new.side := case
      when lower(coalesce(new.type, '')) in ('buy', 'long') then 'LONG'
      when lower(coalesce(new.type, '')) in ('sell', 'short') then 'SHORT'
      else upper(coalesce(new.type, 'LONG'))
    end;
  end if;

  new.entry_price := coalesce(new.entry_price, new."entryPrice", new.price, 0);
  new.exit_price := coalesce(
    new.exit_price,
    new."exitPrice",
    case when lower(coalesce(new.status, 'open')) = 'open' then 0 else null end,
    0
  );
  new.qty := coalesce(new.qty, new.amount, 0);
  new.raw_pnl := coalesce(new.raw_pnl, 0);
  new.fees := coalesce(new.fees, 0);
  new.net_pnl := coalesce(new.net_pnl, new.pnl, 0);
  new.strategy_executed := coalesce(
    nullif(trim(new.strategy_executed), ''),
    left(coalesce(new.notes, 'edge-bot'), 500)
  );

  return new;
end;
$fn$;

drop trigger if exists trades_before_insert_sync_legacy on public.trades;
create trigger trades_before_insert_sync_legacy
  before insert on public.trades
  for each row
  execute function public.trades_sync_legacy_columns();

drop trigger if exists trades_before_update_sync_legacy on public.trades;
create trigger trades_before_update_sync_legacy
  before update on public.trades
  for each row
  execute function public.trades_sync_legacy_columns();

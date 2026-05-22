-- Open bot rows must not carry closed_at (breaks open-position queries / UI).
-- Rollback: revert function only; data cleanup is safe to keep.

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

  if lower(coalesce(new.status, 'open')) = 'open' then
    new.closed_at := null;
    new.opened_at := coalesce(new.opened_at, now());
  else
    new.opened_at := coalesce(new.opened_at, new.closed_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$fn$;

update public.trades
set closed_at = null, updated_at = now()
where status ilike 'open'
  and closed_at is not null;

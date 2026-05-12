-- Grinder lung room: wider stops + 2:1 TP floor on paper autopilot symbols.
update public.bot_settings
set
  stop_loss_pct = case
    when symbol ilike '%PEPE%' then greatest(coalesce(stop_loss_pct, 0), 2.0)
    else greatest(coalesce(stop_loss_pct, 0), 1.5)
  end,
  take_profit_pct = greatest(coalesce(take_profit_pct, 0), 3.0),
  updated_at = now()
where coalesce(is_live_trading_enabled, false) = false
  and symbol in ('BTCUSDT', 'SOLUSDT', 'PEPEUSDT');

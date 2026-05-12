-- Widen scalp stops / TP and raise entry floors for paper autopilot symbols.
update public.bot_settings
set
  stop_loss_pct = case
    when symbol ilike '%PEPE%' then greatest(coalesce(stop_loss_pct, 0), 1.25)
    else greatest(coalesce(stop_loss_pct, 0), 0.75)
  end,
  take_profit_pct = greatest(coalesce(take_profit_pct, 0), 1.5),
  min_tech_score = greatest(coalesce(min_tech_score, 0), 6),
  min_ai_confidence = greatest(coalesce(min_ai_confidence, 0), 65),
  updated_at = now()
where coalesce(is_live_trading_enabled, false) = false
  and symbol in ('BTCUSDT', 'SOLUSDT', 'PEPEUSDT');

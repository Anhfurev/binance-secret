-- Aggressive small-account tuning: faster TP targets + lower AI floor.
update public.bot_settings
set
  take_profit_pct = case
    when symbol in ('DOGEUSDT', 'PEPEUSDT') then 8.0
    else 2.5
  end,
  min_ai_confidence = 52,
  trailing_stop_pct = 0.008
where user_id = 'b0694630-fed7-4ed5-83a7-bd351ec02a6a'::uuid
  and is_autopilot_enabled = true
  and coalesce(is_ghost_execution, false) = false;

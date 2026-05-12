-- Paper autopilot: more concurrent slots and slightly lower entry floors (quality gates remain in edge).
update public.bot_settings
set
  max_open_trades = greatest(coalesce(max_open_trades, 0), 4),
  min_ai_confidence = least(coalesce(min_ai_confidence, 65), 58),
  min_ai_confidence_ranging = coalesce(min_ai_confidence_ranging, 52),
  min_ai_confidence_trending = coalesce(min_ai_confidence_trending, 56),
  min_tech_score = least(coalesce(min_tech_score, 6), 5),
  is_aggressive_mode = true,
  updated_at = now()
where coalesce(is_autopilot_enabled, false) = true
  and coalesce(is_live_trading_enabled, false) = false
  and symbol in ('BTCUSDT', 'SOLUSDT', 'PEPEUSDT');

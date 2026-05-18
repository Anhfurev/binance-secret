-- Small-wallet tuning: 23% risk (~$6.44 on $28), 10 symbols, max 5 open trades.
-- bot_settings = Edge LIVE bot (per symbol). Paper route uses demo_workspaces.paperSettings.
-- Rollback: manually restore risk_percent / delete inserted rows.

update public.bot_settings
set
  risk_percent = 23,
  max_open_trades = 5,
  updated_at = now()
where user_id = 'b0694630-fed7-4ed5-83a7-bd351ec02a6a';

-- Align paper-scalp workspace policy (payload + settings jsonb).
update public.demo_workspaces
set
  settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
    'riskPerTradePercent', 23,
    'maxOpenPositions', 5
  ),
  payload = jsonb_set(
    coalesce(payload, '{}'::jsonb),
    '{paperSettings}',
    coalesce(payload->'paperSettings', '{}'::jsonb) || jsonb_build_object(
      'riskPerTradePercent', 23,
      'maxOpenPositions', 5
    ),
    true
  );

update public.user_demo_workspaces
set
  settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
    'riskPerTradePercent', 23,
    'maxOpenPositions', 5
  ),
  payload = jsonb_set(
    coalesce(payload, '{}'::jsonb),
    '{paperSettings}',
    coalesce(payload->'paperSettings', '{}'::jsonb) || jsonb_build_object(
      'riskPerTradePercent', 23,
      'maxOpenPositions', 5
    ),
    true
  );

insert into public.bot_settings (
  user_id,
  is_autopilot_enabled,
  symbol,
  risk_percent,
  rsi_buy_threshold,
  rsi_sell_threshold,
  stop_loss_pct,
  take_profit_pct,
  trailing_stop_pct,
  max_drawdown_limit,
  is_live_trading_enabled,
  is_aggressive_mode,
  min_ai_confidence,
  max_open_trades,
  min_ai_confidence_trending,
  min_ai_confidence_ranging,
  min_tech_score,
  min_volume_24h_quote,
  min_profit_after_fees_pct,
  is_ghost_execution
)
select
  'b0694630-fed7-4ed5-83a7-bd351ec02a6a'::uuid,
  true,
  sym,
  23,
  case when sym in ('PEPEUSDT', 'DOGEUSDT', 'SHIBUSDT') then 60 else 58 end,
  68,
  case when sym in ('PEPEUSDT', 'DOGEUSDT') then 8.5 when sym = 'BTCUSDT' then 2.5 else 2.5 end,
  case when sym in ('PEPEUSDT', 'DOGEUSDT') then 15 else 5 end,
  case when sym = 'BTCUSDT' then 0.0035 when sym in ('PEPEUSDT', 'DOGEUSDT') then 0.0175 else 0.005 end,
  25,
  false,
  true,
  case when sym in ('PEPEUSDT', 'DOGEUSDT') then 60 else 55 end,
  5,
  52,
  54,
  case when sym = 'BTCUSDT' then 4 else 3 end,
  0,
  0.1,
  false
from unnest(array[
  'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT'
]::text[]) as sym
where not exists (
  select 1
  from public.bot_settings b
  where b.user_id = 'b0694630-fed7-4ed5-83a7-bd351ec02a6a'
    and b.symbol = sym
);

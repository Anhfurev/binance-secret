-- Paper-scalp policy on demo workspaces (payload.paperSettings + optional settings column).
-- Rollback: alter table public.demo_workspaces drop column if exists settings;

alter table public.demo_workspaces
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.user_demo_workspaces
  add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column public.demo_workspaces.settings is
  'Paper-scalp tunables: riskPerTradePercent, symbols[], maxOpenPositions';

update public.demo_workspaces
set
  settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
    'riskPerTradePercent', 20,
    'maxOpenPositions', 5,
    'symbols', jsonb_build_array(
      'BTCUSDT', 'SOLUSDT', 'PEPEUSDT', 'ETHUSDT', 'BNBUSDT',
      'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT'
    )
  ),
  payload = jsonb_set(
    coalesce(payload, '{}'::jsonb),
    '{paperSettings}',
    coalesce(payload->'paperSettings', '{}'::jsonb) || jsonb_build_object(
      'riskPerTradePercent', 20,
      'maxOpenPositions', 5,
      'symbols', jsonb_build_array(
        'BTCUSDT', 'SOLUSDT', 'PEPEUSDT', 'ETHUSDT', 'BNBUSDT',
        'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT'
      )
    ),
    true
  );

update public.user_demo_workspaces
set
  settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
    'riskPerTradePercent', 20,
    'maxOpenPositions', 5,
    'symbols', jsonb_build_array(
      'BTCUSDT', 'SOLUSDT', 'PEPEUSDT', 'ETHUSDT', 'BNBUSDT',
      'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT'
    )
  ),
  payload = jsonb_set(
    coalesce(payload, '{}'::jsonb),
    '{paperSettings}',
    coalesce(payload->'paperSettings', '{}'::jsonb) || jsonb_build_object(
      'riskPerTradePercent', 20,
      'maxOpenPositions', 5,
      'symbols', jsonb_build_array(
        'BTCUSDT', 'SOLUSDT', 'PEPEUSDT', 'ETHUSDT', 'BNBUSDT',
        'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT'
      )
    ),
    true
  );

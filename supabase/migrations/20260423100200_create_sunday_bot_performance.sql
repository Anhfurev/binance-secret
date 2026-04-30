create or replace view public.sunday_bot_performance as
with weekly_trades as (
  select
    t.id,
    t.symbol,
    coalesce(t.pnl, 0) as pnl,
    coalesce(t."pnlPercent", 0) as pnl_percent,
    coalesce(t.closed_at, t.updated_at, t.opened_at, now()) as trade_ts
  from public.trades t
  where coalesce(t.closed_at, t.updated_at, t.opened_at, now()) >= now() - interval '7 days'
    and t.type = 'sell'
),
trade_ai as (
  select
    wt.id,
    wt.symbol,
    wt.pnl,
    wt.pnl_percent,
    (
      select (l.meta->>'ai_confidence')::numeric
      from public.logs l
      where l.source = 'decision-trace'
        and l.symbol = wt.symbol
        and l.created_at <= wt.trade_ts
        and l.meta ? 'ai_confidence'
      order by l.created_at desc
      limit 1
    ) as ai_confidence
  from weekly_trades wt
),
symbol_rollup as (
  select
    ta.symbol,
    round(sum(ta.pnl)::numeric, 8) as total_profit_last_week,
    round(avg(ta.ai_confidence) filter (where ta.pnl_percent > 0)::numeric, 2) as avg_ai_confidence_success,
    round(avg(ta.ai_confidence) filter (where ta.pnl_percent <= 0)::numeric, 2) as avg_ai_confidence_failed
  from trade_ai ta
  group by ta.symbol
),
active_key as (
  select
    case
      when l.meta ? 'gemini_key_id' then l.meta->>'gemini_key_id'
      when l.meta ? 'key_index' then 'Key #' || (((l.meta->>'key_index')::int) + 1)::text
      else null
    end as gemini_key_name,
    count(*) as uses
  from public.logs l
  where l.source = 'ai'
    and l.created_at >= now() - interval '7 days'
    and (
      (l.meta ? 'event' and l.meta->>'event' = 'gemini_key_success')
      or l.message ilike '[Key #%] Success'
    )
  group by 1
  order by uses desc, gemini_key_name asc
  limit 1
)
select
  sr.symbol,
  sr.total_profit_last_week,
  sr.avg_ai_confidence_success,
  sr.avg_ai_confidence_failed,
  coalesce(ak.gemini_key_name, 'unknown') as most_active_gemini_key_name
from symbol_rollup sr
left join active_key ak on true;

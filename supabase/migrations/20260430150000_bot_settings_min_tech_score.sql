-- Tunable floor for technical score (0–10 scale from `calculateTechnicalScore`).
-- Legacy behavior: pass when score > 4 → inclusive minimum 5.
alter table public.bot_settings
  add column if not exists min_tech_score integer;

update public.bot_settings
set min_tech_score = 5
where min_tech_score is null;

alter table public.bot_settings
  alter column min_tech_score set default 5;

comment on column public.bot_settings.min_tech_score is
  'Inclusive minimum technical score (1–10) for strategy BUY path and AI invoke gate (default 5 = legacy >4). Lower when audits show persistent FAIL_TECH_SCORE.';

-- Pro-tip: if last 100 war_room_audits rows for a bot show ≥90% FAIL_TECH_SCORE in veto_details, nudge aggression, e.g.:
--   update public.bot_settings
--   set min_tech_score = greatest(3, coalesce(min_tech_score, 5) - 1), updated_at = now()
--   where id = '<bot_settings.id>';
--
-- Example audit (replace :bot_id):
--   with last100 as (
--     select veto_details
--     from public.war_room_audits
--     where bot_id = :bot_id
--     order by created_at desc
--     limit 100
--   )
--   select
--     count(*) as n,
--     round(100.0 * sum(case when veto_details ilike '%FAIL_TECH_SCORE%' then 1 else 0 end) / nullif(count(*), 0), 1) as pct_fail_tech
--   from last100;

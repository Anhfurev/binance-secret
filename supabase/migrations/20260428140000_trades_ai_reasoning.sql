-- Full-text AI analysis persisted on BUY rows for audit / UI.

alter table public.trades
  add column if not exists ai_reasoning text;

comment on column public.trades.ai_reasoning is
  'Primary model + optional Groq veto text captured when a BUY trade is opened.';

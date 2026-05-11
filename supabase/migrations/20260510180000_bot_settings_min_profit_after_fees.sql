-- Minimum net take-profit % after estimated round-trip taker fees (see buy-prep + paper-fill).
-- Example: TP 0.5% with ~0.2% round-trip (2×0.1%) → net ~0.3%. If this column is 0.25, BUY proceeds.
-- NULL → Edge uses DEFAULT_MIN_PROFIT_AFTER_FEES_PCT (default 0.15). Set to 0 to require no extra net floor beyond TP > fees implicitly.

alter table public.bot_settings
  add column if not exists min_profit_after_fees_pct numeric(10, 4);

comment on column public.bot_settings.min_profit_after_fees_pct is
  'Minimum expected net take-profit % (take_profit_pct minus estimated 2×taker fee %) before opening a BUY. NULL uses Edge default; 0 disables the extra floor.';

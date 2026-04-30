-- Operational notes (no schema change):
-- 1) Stale reservation cleanup: binance-bot `index.ts` deletes capital_reservations
--    with created_at older than 5 minutes at end of each successful cron cycle.
-- 2) Reconciler may set trades.status = 'RECONCILED_CLOSED' (see reconciler.ts).

select 1;

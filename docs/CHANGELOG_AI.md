# AI session changelog (bot & app)

Append-only log so **future chats** can see what changed in large working sessions without re-reading the whole repo.

**How to refresh:** After a big session, ask: *“Summarize our progress into `docs/CHANGELOG_AI.md` so future chats know the state of the bot.”*

**Stable reference:** Schema, `bot_settings` / `trades` columns, and DB-vs-repo gaps live in [`docs/CURRENT_STATE.md`](./CURRENT_STATE.md).

---

## 2026-05-03 — BUY sizing uses `bot_settings` (not hardcoded $20)

**Summary**
- `executeBuyFlow` had a hardcoded **$20** floor and ignored `trade_size_usd` / `risk_percent`.
- Sizing is now: **`TRADING_AMOUNT` env** if set, else **`resolveTradeSizeUsd`** (`fixed_trade_usd` / `trade_size_usd`, else PEPE default cap, else `%` of balance).
- PEPE: explicit `trade_size_usd` on the row now overrides the default **$20** meme cap.

---

## 2026-05-03 — bot_debug_traces + explicit AI cache invalidation

**Summary**
- Migration `20260503140000_bot_debug_traces_bot_id_cache_invalidate.sql`: ensure
  `bot_debug_traces` has `user_id`, `bot_id`, `cycle_id`, partial unique index for
  upserts, dedupe helper, and `bot_settings.ai_cache_invalidate_until`.
- Replaced broken `wasSettingsRecentlyChanged` (always true for boolean columns →
  5m cache bypass after any `updated_at` bump) with **`shouldBypassAiCacheFromSettings`**
  reading only `ai_cache_invalidate_until`.
- `app/api/bot-settings` POST sets `ai_cache_invalidate_until = now()+10m` on saves;
  Gemini quota fallback sets it to the cooldown end when switching to OpenAI-only.

---

## 2026-05-03 — Paper/ghost “best defaults” (DB)

**Summary**
- For all rows with **paper + ghost** (`is_live_trading_enabled = false` and `is_ghost_execution = true`): set `is_aggressive_mode = true`, `max_drawdown_limit = COALESCE(..., 25)`, keep non-null `take_profit_pct` / `stop_loss_pct`, and keep `min_volume_24h_quote` at `0` (volume gate off unless you explicitly set a floor).
- **Live** bots (`is_live_trading_enabled = true`) were not touched by that update — flip aggressive off manually when going live if you want stricter gates.

---

## 2026-05-03 — Cache + drawdown + Sentry hardening (multi-fix)

**Summary**
- **DB migration `20260503110000_ai_cache_score_breakdown`**: added the missing
  `trend_score`, `momentum_score`, `volume_score`, `order_book_score`,
  `sentiment_haircut_applied`, `sentiment_penalty_factor` columns to
  `public.ai_cache` (root cause of `column ai_cache.trend_score does not exist`
  spam + every cycle bypassing cache → +latency, +AI cost).
- Reset paper drawdown wall: `profiles.starting_balance` resynced to current
  `demo_balance`; `max_drawdown_limit` lifted from `5.00` → `25.00` (paper
  account was 4.67% drawn at a 5% kill-switch, blocking new BUYs).
- Backfilled `bot_settings.take_profit_pct = 1.5` and `stop_loss_pct = 1.0`
  for the three bots whose values were `NULL` (violated project rule
  "bot must use DB take_profit_pct for exits").
- `emitSentryFatalException` no longer turns objects into `[object Object]`;
  added a `stringifyForSentry` that extracts `code/message/details` and
  attaches a `fatal_raw` context with the truncated payload preview.
- War Room Sentry signals (`war_room_gate_passed`, `war_room_quorum_failed`)
  downgraded from `captureMessage` to **breadcrumbs only** — they were
  flooding Sentry Issues despite Seer marking them `super_low`.

---

## 2026-05-03 — debugger_health_only avoids Edge WORKER_RESOURCE_LIMIT

**Summary**
- `debugger_health_only` no longer runs forced retention deletes in parallel with snapshot/stale guard/debugger (that combo could exceed Supabase Edge memory/time and return `WORKER_RESOURCE_LIMIT`).
- Optional body flag: `debugger_include_retention: true` runs the same forced retention **after** the parallel phase, sequentially.
- Follow-up: run snapshot → stale guard → debugger **sequentially** (not `Promise.all`), shrink `war_room_audits` sample to 40 rows, and apply profile `starting_balance` resyncs **one row at a time** so Edge stays within limits.
- When PostgREST returns a Cloudflare HTML page (e.g. **522** origin timeout), `safe-execute` and `stale_trade_guard` now log a **short code** (`cloudflare_522_supabase_origin_timeout`, etc.) instead of multi‑KB HTML in `public.logs`.

---

## 2026-04-30 — Debugger health mode + auto-fixes

**Summary**
- Added `supabase/functions/binance-bot/health-debugger.ts` with `runDebuggerHealthAndFix` to run a focused bot debugger pass (env checks, recent error pressure, symbol cycle failures, stale capital reservation lock detection, HOLD-dominance signal).
- Added request mode in `supabase/functions/binance-bot/index.ts`: send `{"debugger_health_only": true}` to run debugger without full trading cycle.
- Added optional fixer toggle: `debugger_apply_fixes` (default true). Current automatic fixes: stale `capital_reservations` purge and expired `ai_quota_state` cooldown reset.

**Bot / stack**
- Debugger writes a structured `logs` event with source `debugger-health` and includes issue/fix payloads for traceability.
- `debugger_health_only` runs snapshot, stale-trade guard, and debugger; retention is optional via `debugger_include_retention` (see 2026-05-03 note).

**Open risks / follow-ups**
- `index.ts` remains oversized and should be split (`debugger` / `request-router` extraction) to match file-size policy.
- Consider adding DB-side retention for `public.logs` by severity class (keep `error` longer, prune `info` aggressively).

---

## 2026-04-30 — Always-on no-trade fallback helper

**Summary**
- Added `supabase/functions/binance-bot/no-trade-fallback.ts` with `resolveNoTradeFallback` to detect long inactivity and temporarily relax entry gates.
- Wired into `supabase/functions/binance-bot/run-symbol-batch.ts` so fallback runs every cycle automatically (always available).

**Bot / stack**
- Activation rule: no BUY for ~10 days (or never bought yet) and no open trade.
- On activation, cycle uses adjusted thresholds:
  - `min_ai_confidence`: up to `-10` points (floor `55`)
  - `min_tech_score`: up to `-2` points (floor `3`)
  - forces aggressive mode path for that cycle.
- Preflight veto payload now includes `NO_TRADE_FALLBACK_ACTIVE:*` marker for audit/debug visibility.

**Open risks / follow-ups**
- Fallback is intentionally permissive to break long HOLD streaks; monitor first week closely and tighten floors if entries become too frequent.

---

## 2026-05-03 — Demo / paper bot trade unblock

**Summary**
- `bot-buy.ts`: drawdown breach in **paper mode** no longer disables `is_autopilot_enabled` (only logs + skips that BUY); live mode behavior unchanged.
- `bot-buy.ts`: skip `reserve_buy_capital` RPC for paper-only mode (no real wallet to reserve, fixes `reserve_buy_capital_null` phantom blocks).
- `health-debugger.ts`: auto re-enables paper bots whose autopilot was previously turned OFF, and resyncs `profiles.starting_balance` to current `demo_balance` so old paper drawdown can't keep blocking.
- `demo-paper-probe-buy.ts`: inactivity threshold lowered to 6 hours, cooldown 90 minutes — designed to surface at least one paper BUY per day on demo accounts.

**Bot / stack**
- Live trading (`is_live_trading_enabled=true`) keeps the original drawdown autopilot disable + capital reservation behavior.
- Demo bot resumes trading without manual `is_autopilot_enabled` reset after past paper losses.

**Open risks / follow-ups**
- Once you flip a bot to live, drawdown breach disable + reservation RPC come back automatically.

---

## 2026-04-30 — Paper/demo probe BUY after long inactivity

**Summary**
- Added `supabase/functions/binance-bot/demo-paper-probe-buy.ts`: when `is_live_trading_enabled` is false (demo/paper), no open trade, and no BUY for ≥10 days (or never), upgrade HOLD → BUY once per cooldown window so execution can reach `executeBuyFlow`.
- `executeBuyFlow` accepts `demoProbeBuy` to bypass RANGING dip gate and War Room quorum/news veto **only** when live trading is disabled (never on real Binance path).
- Raised latency Telegram threshold to 15s (parallel symbol batches often exceed 8s).

**Bot / stack**
- Cooldown log `demo_paper_probe_activated` (source `demo-probe-buy`) prevents probe spam (minimum gap between activations).
- `no-trade-fallback.ts` inactivity window aligned to 10 days.

**Open risks / follow-ups**
- Probe is aggressive by design for demo validation; keep `is_live_trading_enabled=false` until you intentionally go live.

---

## 2026-04-27 — Remove Cursor `stop` hook (changelog)

Removed `.cursor/hooks.json` so agent completion no longer auto-submits a follow-up to edit this file. Changelog updates are manual or by explicit ask only.

---

## 2026-04-27 — Docs / hook copy

Shorter `CHANGELOG_AI` intro + hook follow-up strings; trimmed `project-rules` / `agent-automation`; `.gitignore` → `.cursor/hooks/__pycache__/`. No bot/app logic.

---

## 2026-04-27 — Edge parallel cron + demo/settings sweep

**Summary** — `supabase/functions/binance-bot/index.ts`: multi-bot cron uses `Promise.allSettled` instead of a serial loop with 500ms sleeps; `force_buy_override` skips case-normalized Groq `REJECT`. Wider Next.js edits: `app/demo/page.tsx` and demo components, `app/settings`, `app/page`, optimizer/predictions/signals/whale/help, layout/nav, dashboard blocks, `hooks/use-dashboard-data.ts`, `lib/binance.ts`. `package.json` / `package-lock.json`, `supabase/setup-cron.sql`, `supabase/functions/binance-bot/deno.json`, `.env.example` / `.gitignore` touched.

**Bot / app** — Edge cron fans out per active bot row; UI/settings and data hooks drift toward current product surfaces (see same-day “Ghost trade” / tunables sections for close-path and `POST /api/bot-settings` RSI fields).

**Follow-ups** — Deploy `binance-bot`; watch Binance/API concurrency under parallel cycles; reconcile `npm` lockfile and run `tsc` on changed TS before ship.

---
## 2026-04-27 — Settings page now persists tunables to DB + Groq veto hard wall.

---

## 2026-04-27 — Ghost trade UI & close integrity

**Summary** — `app/demo/page.tsx`: manual close `UPDATE` + `.select("id")`, throw if zero rows before SELL insert; `await mutateOpenTrades()` after `mutateTrades()`. `bot-sell.ts`: same on Edge close — no `insertTrade` SELL row if UPDATE matched nothing. `trade-store.ts` (`loadOpenTrade`), `index.ts` (Telegram open list + max-open count), `lib/learning-mode.ts`: use `.ilike("status","open")` instead of `open`/`OPEN` filters.

**Bot / app** — `/demo` open list revalidates on close; ledger cannot add a closed SELL without closing the BUY row. Case-insensitive `status` aligns UI, bot, and learning paths.

**Follow-up** — If CCXT filled but DB UPDATE hits 0 rows, sell flow throws (manual / alert reconcile vs exchange).

---

## 2026-04-27 — `POST /api/bot-settings` tunables + `force_buy_override` safety gates

**Summary**

- **`app/api/bot-settings/route.ts`**: POST merges validated numeric fields into the existing `bot_settings` update (and into the fallback per-symbol upsert): `min_ai_confidence` (1–100 int), `max_open_trades` (0–100 int), `risk_percent` (0.1–100), `stop_loss_pct` (0.1–50), `take_profit_pct` (0.1–100), `trailing_stop_pct` (0.0001–100). Keys omitted from JSON leave columns unchanged.
- **`supabase/functions/binance-bot/index.ts`**: `shouldForceBuy` now requires `ai.groq_verdict !== "REJECT"` and `ai.trend !== "bearish"` in addition to confidence and technical score, so the override cannot bypass those gates.

**Bot / app**

- Edge bot reads `min_ai_confidence`, `max_open_trades`, and risk/SL/TP/trailing columns from `bot_settings` as before; they can now be written via the same admin-backed API the toggles use.
- **Settings UI** still stores scalping sliders in **localStorage** unless a follow-up POSTs these fields from the settings page — wire `save` → `/api/bot-settings` when ready.

**Risks / follow-ups**

- POST still uses **service role** + `user_id` from body (no session check) — same trust model as the three-boolean POST; lock down if this route is ever exposed beyond trusted automation.
- Deploy **binance-bot** after merging `index.ts` changes.

---

## 2026-04-27 — Absolute `stopLoss` exits + confidence tier no longer clears USD size

**Summary**

- **`supabase/functions/binance-bot/strategy.ts`**: `checkExitConditions` now exits longs when `latestPrice <=` the trade row’s absolute `stopLoss` (and shorts when `latestPrice >=` SL when SL is valid vs entry). Added `readTradeStopLossPrice`, `hasValidDbStopLossPrice`, `hitAbsoluteStopLoss`. The hardcoded `STRATEGY_STOPLOSS` (-25% ROI) runs **only** when there is **no** valid DB stop price on the open row.
- **`supabase/functions/binance-bot/index-ai.ts`**: `resolveConfidenceTierRiskPercent(aiConfidence, row?)` returns `null` (no tier bump) when `trade_size_usd > 0` or `fixed_trade_usd > 0`; otherwise unchanged 5% / 2% tiers for high AI confidence.
- **`supabase/functions/binance-bot/index.ts`**: Passes `row` into that helper; `executionRow` is `{ ...row, risk_percent }` when a tier applies — **does not** set `trade_size_usd` / `fixed_trade_usd` to `null`.
- **`supabase/functions/binance-bot/types.ts`**: Documented optional `stopLoss` on `OpenTradeRow`.

**Bot / stack**

- Exit ladder: absolute TP → % ROI TP → **absolute SL** → -25% ROI fallback (only if no valid row SL) → RSI > 70.
- Position sizing: high-confidence path can still raise `risk_percent` for **risk-percent-only** bots; fixed USD columns are preserved for sizing.

**Risks / follow-ups**

- Row `stopLoss` must stay in sync with `bot_settings.stop_loss_pct` at entry (already set on BUY); trailing / break-even updates that move `stopLoss` in DB are respected by the new price check.
- Audit bullets **resolved** by this ship: per-trade `stopLoss` used for exits; tier no longer wipes `trade_size_usd` / `fixed_trade_usd`. Later same day: **`force_buy_override`** gates and **`POST /api/bot-settings` tunables** — see section above. Still open: ghost-trade UI + `bot-sell` UPDATE assert, performance plan — see audit section below.

---

## 2026-04-27 — Kill 10% ROI ghost + paper SL/TP override; full-stack autopilot audit

**Summary**

- **`supabase/functions/binance-bot/strategy.ts`**: removed `DEFAULT_STRATEGY_MINIMAL_ROI = 0.1` (the 10% ROI ghost). `resolveMinimalRoiFromPctSources` now returns `NaN` when neither the open trade nor settings provides a finite `take_profit_pct`, and `checkExitConditions` only triggers `roi_target_hit` when `Number.isFinite(minimalRoi) && minimalRoi > 0`. Absolute TP price (`hitAbsoluteTakeProfit`) and the rest of the exit ladder unchanged.
- **`supabase/functions/binance-bot/bot-buy.ts`**: removed the test-mode `1% / 2%` SL/TP override. Paper and live now both use `clamp(toNumber(row.stop_loss_pct, 2), 0.1, 50)` and `clamp(toNumber(row.take_profit_pct, 4), 0.1, 100)` from `bot_settings`.
- Conducted a full-stack deep audit (no further code changes this turn). Findings recorded under "Open risks / follow-ups" below so the next session can act on them.

**Bot / stack**

- Exit logic now strictly DB-driven for the percentage-ROI path: no implicit 10% target. Per-trade absolute `takeProfit` price still honored via `hitAbsoluteTakeProfit`.
- BUY-side stops/targets: paper trades now mirror live, so demo TP/SL accurately reflect what live trades would do under the same `bot_settings`.
- No changes to `index.ts`, `index-decision.ts`, `index-ai.ts`, `bot-sell.ts`, `bot-shared.ts`, settings page, or any API route this turn.

**Open risks / follow-ups (from audit; partially superseded)**

- ~~**Per-trade `stopLoss` price column is never used to exit.**~~ **Fixed** in the `Absolute stopLoss exits` section above (same date).
- ~~**`force_buy_override` … bypasses safety gates**~~ **Fixed** — `shouldForceBuy` now requires `groq_verdict !== "REJECT"` and `trend !== "bearish"` (see **tunables + force_buy_override** section at top of this date).
- ~~**`resolveConfidenceTierRiskPercent` … silently wipes `trade_size_usd` / `fixed_trade_usd`**~~ **Fixed** — tier only applies when both USD size columns are empty; `index.ts` no longer nulls them.
- ~~**`/api/bot-settings` only persists 3 booleans.**~~ **Partially fixed** — POST now persists the six numeric tunables above; **`rsi_buy_threshold` / `rsi_sell_threshold`** still not in this route; settings page sliders still localStorage until wired to POST.
- **Other hardcoded thresholds that should be DB-tunable**: `index-decision.ts` `aiConf > 88` (extreme), `aiConf > 85` (`ai_panic_sell`), `aiConf >= 75` (technical bearish override — also a dead branch); `bot-sell.ts` `BREAK_EVEN_TRIGGER_PCT = 1.5`; `bot-shared.ts` `breakEvenFloor = entryPrice * 1.001`, `breakEvenGuardActive = currentPnlPct >= 1`.
- **Ghost OPEN trades (UI mismatch)**:
  - `app/demo/page.tsx` `handleCloseTrade` calls `mutateTrades()` but not `mutateOpenTrades()` after the close UPDATE.
  - `bot-sell.ts:183-199` does not assert that the close `UPDATE` matched a row before inserting a new SELL — silent zero-row updates leave the BUY row `open` while the SELL row appears in history.
  - Status-case inconsistency: `loadOpenTrade` uses `.in("status", ["open","OPEN"])`, max-trades count uses `.or(...)`, frontend uses `.ilike("status","open")`. Add a Postgres CHECK on lowercase `status` plus `CREATE UNIQUE INDEX trades_one_open_per_user_symbol ON trades(user_id, symbol) WHERE lower(status) = 'open'`.
- **Performance plan** (with autopilot 24/7, 6 cron invocations/min):
  - Cache `fetchIndicatorSnapshot(symbol)` in a `market_snapshots` table by 30s bucket so multi-user shares the Binance fetch.
  - Replace serial `for` + 500ms `setTimeout` in `index.ts:618-620` with `Promise.allSettled`.
  - Cache `binanceTimeSyncCheck` for ~5 min (skip if drift < 1s).
  - Move pg_cron staggering from `pg_sleep(N)` to second-level cron expressions.
  - Drop SWR `refreshInterval: 3000` on `demo-trades` / `demo-open-trades` once realtime is reliable.
  - Add `idempotency_key` column with unique index instead of JSONB `extra->>bot_id` lookup in `binance.ts:135-146`.

---

## 2026-04-27 — docs + bot surface area

**Summary**

- Added **`docs/CURRENT_STATE.md`**: documents `public.bot_settings` and `public.trades` as defined in `supabase/setup-trading-schema.sql`, lists columns used by the app/Edge Functions that may not be in that script (`is_live_trading_enabled`, `is_aggressive_mode`, `min_ai_confidence`, `max_open_trades`; trades `price`, `extra`, optional execution fields), notes `(user_id, symbol)` upsert expectation, and includes example JSON rows plus migration note `supabase/migrations/20260427120000_enable_autopilot_all_bot_settings.sql`.
- **Quality gates (from that doc):** `npm run lint` pass; `npx tsc --noEmit` still fails on several existing files; no `npm test` in `package.json`.

**Bot / stack (high level)**

- Trading bot logic lives under **`supabase/functions/binance-bot/`** (modular handlers: `bot-buy`, `bot-sell`, `trade-store`, `execution`, AI/strategy pieces, etc.).
- Next app: dashboard/demo, settings, APIs under `app/api/*` (e.g. `bot-settings`, `profile-balance`, `recent-activity`, `technical-pulse`, automation learning).

**Open risks for the next session**

- Align **deployed Postgres** with code: extra `bot_settings` columns, unique on `(user_id, symbol)`, trades `price` / `extra` (and any columns used by `execution-helpers.ts` inserts).
- **Typecheck** debt: fix or narrow `tsc` errors called out in `CURRENT_STATE.md` when touching those files.

---

## Template (copy for the next entry)

```markdown
## YYYY-MM-DD — short title

**Summary**
- Bullet: what shipped or changed.

**Bot / stack**
- Bullet: functions, APIs, env, flags.

**Open risks / follow-ups**
- Bullet: migrations, tests, known bugs.
```

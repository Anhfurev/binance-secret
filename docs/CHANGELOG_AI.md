# AI session changelog (bot & app)

Append-only log so **future chats** can see what changed in large working sessions without re-reading the whole repo.

**How to refresh:** After a big session, ask: *“Summarize our progress into `docs/CHANGELOG_AI.md` so future chats know the state of the bot.”*

**Stable reference:** Schema, `bot_settings` / `trades` columns, and DB-vs-repo gaps live in [`docs/CURRENT_STATE.md`](./CURRENT_STATE.md).

---

## 2026-05-20 — Paper snapshot learning columns (what we hold / why P&L)

**Summary**

- Migration `20260520170000_paper_snapshot_details.sql`: `free_cash_usdt`, `open_legs_value_usdt`, `session_pnl_usdt`, `session_pnl_pct`, `open_leg_count`, `tick_summary`, `regime_label`, `details` jsonb on `paper_portfolio_snapshots`.
- **`paper-snapshot-payload.ts`:** Each tick stores open legs (symbol, entry, mark, unrealized P&L, trail SL), actions, `loss_note` when session is red.
- **`paper-portfolio-snapshot.ts`:** v5-details insert; slim fallback if migration not applied yet.

**Query example:** `select recorded_at, portfolio_nav_usdt, session_pnl_usdt, regime_label, details->'open_legs' from paper_portfolio_snapshots order by recorded_at desc limit 20;`

---

## 2026-05-20 — Silent paper DB logs (no snapshot/position spam)

**Summary**

- **`paper-portfolio-snapshot.ts`:** Slim-only inserts; legacy path only if `PAPER_SNAPSHOT_LEGACY=1`; no `console.warn` (use `PAPER_DEBUG=1` to trace).
- **`paper-positions-db.ts`:** Invalid-leg / insert failures debug-only.
- **`paper-run-persist.ts`:** Profile async errors debug-only.

---

## 2026-05-20 — Slim snapshot schema (no total_nav_usdt) + NAV NaN fix

**Summary**

- **`paper-portfolio-snapshot.ts`:** Slim insert uses only `portfolio_nav_usdt` (fixes PostgREST “Could not find total_nav_usdt” on prod).
- **NAV:** Finite cash/starting in `computePaperWorkspaceNav`; coerce legs in `normalizePaperWorkspaceAccount`; Telegram manifest sanitizes before display.
- **Profiles:** `applyLiveProfileNav` writes sanitized NAV only.

---

## 2026-05-20 — entry_price null on paper_positions + hydrate fix

**Summary**

- **`paper-trade-coerce.ts`:** Map legacy `entry_price` / `qty` from workspace JSON → `entryPrice` / `amount`.
- **`demo-account.ts` `hydrateAccount`:** Coerce open legs on load (fixes legs `42` / `44` with missing entry).
- **`paper-positions-db.ts`:** Skip invalid inserts; prune orphan DB rows; never send null `entry_price`.
- **`paper-portfolio-snapshot.ts`:** Hard `safeNavUsdt` + legacy retry when `portfolio_nav_usdt` NOT NULL fails.
- **`paper-scalp-engine.ts`:** `normalizePaperWorkspaceAccount` before `syncOpenPositionsToDb`.

---

## 2026-05-20 — Snapshot null NAV + master-only DB merge

**Summary**

- **`paper-nav-sanitize.ts`:** Strip corrupt legs (0 entry/qty); coerce finite NAV before DB/Telegram (fixes `portfolio_nav_usdt` null — JSON `NaN` → null).
- **`paper-portfolio-snapshot.ts`:** Unified + legacy snapshot insert; `loadNavSnapshotAtOrBefore` reads `total_nav_usdt` fallback.
- **`paper-run-prepared.ts`:** `paper_positions` merge only on **master** workspace (stops 4× duplicate legs / wallet-reset noise).
- **`paper-run-orchestrator.ts`:** One snapshot per tick on master; removed per-close/per-persist snapshot spam.
- **`paper-scalp-engine.ts`:** Default `MICRO_MAX_OPEN` cap 2 when env unset (aligns correlation filter).
- Migration `20260520160000_paper_snapshot_nav_compat.sql`; VPS backup `scripts/paper-run-cron.sh` (2m curl).

**Deploy:** `supabase db push` (or apply migration on `emviaygygylosvmtsvlq`), then `git pull && npm run build && pm2 restart binance-app binance-ws-daemon --update-env`.

---

## 2026-05-20 — Paper NAV double-count fix ($28 cash + $38 legs → $66)

**Summary**

- **Bug:** `mergeAccountWithLiveProfile` reset `currentBalance` to profile `available_usdt` ($28) while open legs stayed in memory → NAV = cash + marks double-counted (~$66).
- **`paper-cash-reconcile.ts`:** `dedupeOpenPositionsBySymbol` + `reconcilePaperAccountCash` (free cash = starting − deployed at entry).
- **`paper-portfolio-db.ts`:** DB legs refresh trails only; no merge-by-id duplicate symbols into one workspace.
- **Telegram:** After deploy, expect ~$28 NAV (or ~$9 cash + ~$19 marks for 2 legs), not $66 with $28 free cash.

---

## 2026-05-19 — Paper trades varchar(50) + $28 wallet baseline fix

**Summary**

- **`paper-trades-sync.ts` / `paper-trades-db-text.ts`:** Truncate legacy string fields before `trades` insert; short `strategy_executed` keys (fixes `varchar(50)` errors on prod legacy schema).
- **`paper-trades-db-safe.ts`:** Legacy upsert lookup by full `extra.paper_leg_id` instead of truncated strategy key.
- **`paper-portfolio-db.ts` / `paper-profile-live.ts` / `paper-scalp-wallet.ts`:** Session baseline uses configured `PAPER_SCALP_WALLET_USD` ($28), not inflated `portfolio_nav_usdt`; profile `starting_balance` synced on NAV write.
- Migration: `20260520150000_trades_text_columns.sql` widens legacy `trades` string cols to `text`.

---

## 2026-05-19 — Unified paper DB layer (4-table schema)

**Summary**

- Rewrote `paper-positions-db`, `paper-portfolio-db`, `paper-trades-sync`, `paper-trade-db-map`, `paper-profile-live`, `micro-scalp-drawdown` for clean-slate tables: `profiles`, `paper_positions`, `paper_portfolio_snapshots`, `trades` (lowercase snake_case columns only).
- Open legs → `paper_positions` (`qty`, `trail_price`, `layer`); closed legs → `trades` (`raw_pnl`, `fees`, `net_pnl`, `strategy_executed`, `closed_at`); NAV snapshots → `user_id` + `portfolio_nav_usdt`.
- Removed queries to `paper_workspace_baselines`, `extra` JSON filters, and PascalCase table names.
- Migration reference: `supabase/migrations/20260520120000_paper_schema_unified.sql`.

---

## 2026-05-22 — Live Binance connect + trades schema restore

- **`cron-telegram-digest.ts`:** 2-min digest lines now include live WS price, WS age, AI action/confidence, RSI, and hold reason (not just `hold` + short code).
- Deployed `binance-bot` Edge to `emviaygygylosvmtsvlq` (`--no-verify-jwt`).
- Migration `20260522120000_restore_trades_bot_schema.sql`: adds `extra`, `status`, camelCase bot columns on `trades` (fixes `42703 column trades.extra does not exist`).
- `.env.example`: Binance API + gateway IP whitelist notes.

## 2026-05-19 — Live profile NAV sync (fix frozen $28)

**Summary**

- **`paper-profile-live.ts`:** Every micro close/open/tick updates `profiles.available_usdt`, `portfolio_nav_usdt`, `demo_balance`.
- **`runMicroScalpEngineTick(watchlist, context)`** + **`runMicroTrailingPass(openPositions, liveCandles, context)`** per Micro Mode spec.
- Prepare hydrates workspace account from live profile before tick (no stale JSON $28).

---

## 2026-05-19 — Micro engine file architecture (1m default)

**Summary**

- **`paper-scalp-engine.ts`:** Core tick router — drawdown circuit, `harvestMicroCandlesParallel`, `runMicroTrailingPass`, acceleration entries.
- **`paper_positions` table** + **`paper-positions-db.ts`:** OPEN legs for trailing persistence.
- **`micro-scalp-acceleration.ts`:** 1m + 3m volume/ROC scanner (no RSI/EMA).
- **`micro-scalp-trailing.ts`:** DB-backed trailing; `MICRO_TRAIL_ARM_PCT` / `MICRO_TRAIL_GAP_PCT`.
- **`micro-scalp-drawdown.ts`:** 24h NAV via `paper_portfolio_snapshots.recorded_at`.
- **`live-micro-order.ts`:** `placeMicroIocLimit` (IOC).
- Default `PAPER_ENGINE_MODE=micro`.

---

## 2026-05-19 — Fee / slippage / chop diagnostics (paper closes)

**Summary**

- **`paper-trade-economics.ts`:** Net P&L after maker/taker fees; `[TRADE LOG]` raw vs net vs slippage; warns on fee trap and weak signal.
- **Paper closes** use net P&L (not gross). Micro entries model REST slip; chop filter blocks sideways whipsaw.
- **`live-micro-order.ts`:** Default maker `GTX` POST_ONLY; `MICRO_ORDER_MODE=taker` for IOC.

**Env:** `PAPER_USE_MAKER_FEES=1`, `PAPER_MAKER_FEE_PCT=0.02`, `PAPER_TAKER_FEE_PCT=0.075`, `PAPER_ASSUMED_SLIPPAGE_PCT=0.04`, `PAPER_MIN_NET_EDGE_PCT` (optional override).

---

## 2026-05-19 — Micro-breakout execution engine (1m/3m)

**Summary**

- **`PAPER_ENGINE_MODE=micro`:** Replaces 15m alpha tick with volume-acceleration entries (3× 1h vol MA in 2m window + ROC), equity-% sizing from live NAV, adaptive 0.5% trail after +1.5%, 24h drawdown pause from `paper_portfolio_snapshots`.
- **Modules:** `micro-scalp-*.ts`, `paper-scalp-micro-klines.ts`, `live-micro-order.ts` (IOC limit helper for live path).
- **Env:** `MICRO_SCALP_INTERVAL=1m|3m`, `MICRO_VOLUME_SPIKE_MULT`, `MICRO_TRAIL_ARM_PCT`, `MICRO_TRAIL_GAP_PCT`, `MICRO_MAX_DRAWDOWN_PCT`, `MICRO_MAX_OPEN`.

---

## 2026-05-19 — Paper portfolio DB persistence (session P&L / history)

**Summary**

- **Migration `20260519150000_paper_portfolio_tracking.sql`:** `paper_workspace_baselines` (persisted session start per workspace) + `paper_portfolio_snapshots` (NAV time series for 24h/7d deltas).
- **`paper-portfolio-db.ts` / `paper-trade-db-map.ts`:** Hydrate workspace accounts from `public.trades` on tick start; record snapshots on persist/close; enrich NAV with DB baseline, 24h/7d, and lifetime realized PnL.
- **`paper-scalp-wallet.ts`:** `alignPaperScalpWallet` no longer wipes `tradeHistory` at 50+ trades or resets to a fresh $28 account.
- **`paper-trades-sync.ts`:** Immediate upsert on ATR close; `extra` stores margin/leverage/PnL.
- **Manifest / logs:** `[PORTFOLIO NAV]` and `[EXECUTION]` show lifetime and 24h metrics from DB when available.

**Deploy:** `supabase db push` (or apply migration in SQL editor). Requires `SUPABASE_SERVICE_ROLE_KEY` + `PAPER_TRADES_USER_ID` for device workspaces.

---

## 2026-05-19 — Paper scalp → `public.trades` sync

**Summary**

- **`paper-trades-sync.ts`:** After each paper tick, open legs + recent `tradeHistory` upsert into `public.trades` (`extra.trade_mode=paper`, `extra.paper_leg_id`). Device workspaces need `PAPER_TRADES_USER_ID` (auth.users uuid) in env.

---

## 2026-05-19 — Alpha Shield Long/Short regime switcher (paper 15m)

**Summary**

- **`paper-scalp-regime.ts`:** `RISK_OFF` (`entryMode: "short"`) no longer sets `blockAltcoinEntries`; only API/BTC snapshot fallback blocks all entries. Bullish/neutral → `entryMode: "long"`.
- **`paper-scalp-velocity.ts`:** ±1.2% candle velocity gates; `pickVelocityBreakdownCandidate` for short hunt; long keeps RVOL+RSI breakout path.
- **`paper-scalp-alpha-entry.ts` / `paper-scalp-alpha-tick.ts`:** Opens `type: "sell"` + `direction: "SHORT"` in short regime; terminal log `[REGIME: ACTIVE_SHORT]` on entry.
- **`paper-scalp-trailing-exit.ts` / `paper-scalp-positions.ts`:** Short ATR trail (trough + ceiling stop), cover on `mark >= stopLoss` or bullish EMA cross.
- **`paper-scalp-engine-manifest.ts`:** Telegram manifest shows `REGIME: ACTIVE_SHORT` and SHORT leg labels.

---

## 2026-05-15 — Groq tiered models (8B scan, 70B high-conviction veto)

**Summary**

- **`ai-groq-models.ts`:** When `GROQ_MODEL` is unset, primary Groq completions default to **`llama-3.1-8b-instant`**; BUY trap review uses **`llama-3.3-70b-versatile`** only when weighted scanner `ai_confidence` ≥ **`GROQ_EXECUTION_MIN_CONFIDENCE`** (default **90**), otherwise the same cheap scan model. Setting **`GROQ_MODEL`** keeps legacy single-model behavior for both paths; **`GROQ_EXECUTION_MODEL`** overrides the deep trap model id. Tiered mode disables Groq veto fast-skip so high-conviction BUYs still get the deep review.
- **`ai-veto.ts`:** Longer default veto timeout when the trap model id matches **`70b`** (override with **`GROQ_VETO_TIMEOUT_MS`**).
- **`ai-keys.ts` / `ai-core.ts` / `cron-runner.ts`:** Optional **`GROQ_API_KEY_SCAN1`…`SCANn`** pool for scan-only Groq completions; **`GROQ_API_KEY` / `GROQ_API_KEY2`** remain the veto / trap ring. DB **`current_groq_scan_key_index`** (`20260515180000_ai_quota_groq_scan_key_index.sql`) round-robins the scan pool separately from **`current_groq_key_index`**.
- **`groq-request-spacing.ts`:** **`GROQ_MIN_REQUEST_GAP_MS`** default spacing **400ms** (was 1200); set **`0`** to disable.
- **`batch-orchestrator.ts` / `batch-validator.ts`:** **`BOT_PARALLEL_SYMBOL_CYCLES`** (default **off**) runs per-symbol bot rows with **`Promise.allSettled`** when set to **`1`**; when Gemini may run (`AI_SKIP_GEMINI` / `GEMINI_DISABLED` unset), parallel cycles are **forced off** and cron runs symbols **sequentially** with **`GEMINI_CRON_SYMBOL_GAP_MS`** (default **2000**, min **2000**) between `runSymbolBatch` calls. When parallel, **`BOT_SYMBOL_STAGGER_MS`** is skipped for that batch.
- **`market-data.ts`:** Lighter OHLCV fetches — default **200** × 1m (env **`MARKET_OHLCV_1M_LIMIT`**, clamp **200–400**), tighter 15m / 1h / 4h limits vs prior **220+** 1m fan-out.
- **`ai-core.ts` / `cron-runner.ts`:** Multi-symbol Groq batch uses **`buildPayload(..., { omitAiScoringRubric: true })`** so the large rubric is not repeated per symbol in one JSON envelope.
- **Multi-provider matrix routing:** `AI_PROVIDER_MATRIX=1` (default on) assigns even cron indices to **Groq-first** and odd to **Gemini-first** with cross-provider fallback gaps; skips consolidated multi-symbol LLM batch; serializes symbols with **`SYMBOL_MATRIX_GAP_MS`** (default **2500**). Wired via `symbolMatrixIndex` cron → `getAiAnalysis`.
- **Groq→Gemini fallback pacing:** After Groq 429 / quota exhaustion, `enforceGroqToGeminiFallbackGap` waits **`GROQ_TO_GEMINI_FALLBACK_GAP_MS`** (default **3000**, min **3000**) before `tryGeminiFlow`. `tryGroqFlow` returns `{ ai, groqQuotaExhausted }` so limit-fallback no longer blocks Gemini. **`GeminiTerminalAuthError`** on `PERMISSION_DENIED` / `CONSUMER_SUSPENDED` aborts the symbol cycle with no per-key rotation backoff.
- **Gemini emergency abort disabled:** `registerGeminiFailureAndAbortIfNeeded` no longer throws `EMERGENCY_ABORT_QUOTA_LIMIT_HIT`; `getAiVerdict` no longer short-circuits on global Gemini cooldown; `tryGeminiFlow` always rotates keys (ignores global + per-key cooldown skips) so multi-key pools keep live fetches.
- **Gemini multi-symbol batch (Solution B):** When **`AI_PRIMARY_LLM` is not `groq`**, cron prefetches one consolidated **`geminiAnalyzeMultiSymbol`** call (`ai-gemini-multi-symbol.ts`) into the same in-memory map as Groq batch; **`getAiAnalysis`** traces **`gemini_multi_symbol_batch`** vs **`groq_multi_symbol_batch`**. Opt out with **`GEMINI_MULTI_SYMBOL_BATCH=0`**; tune **`GEMINI_MULTI_SYMBOL_TIMEOUT_MS`** (default **90s**), **`GEMINI_MULTI_SYMBOL_MAX_OUTPUT_TOKENS`** (default **8192**, cap **16384**). Shared **`ai-multi-symbol-parse.ts`** + **`ai-multi-symbol-batch-store.ts`**.
- **`telegram-decision-trace.ts`:** Opt-in Telegram decision transparency — set **`DECISION_TRACE_TELEGRAM=1`**; quiet cycles throttle per symbol (**`DECISION_TRACE_HOLD_THROTTLE_MS`**, default **1h**); any **AI BUY** or **final BUY** sends immediately. Wired from **`cycle-executor.ts`** after `logDecisionTrace`.
- **Tests:** `ai_groq_models_test.ts`; `ai_veto_policy_test` pins `GROQ_MODEL` for fast-track assertions; `ai_keys_test` covers `SCANn` ordering; `batch_orchestration_test` covers parallel-cycle flag; `telegram_decision_trace_test.ts`; `ai_gemini_multi_symbol_test.ts`; `ai_multi_symbol_parse_test.ts`.

---

## 2026-05-14 — Paper trade starvation fixes (gates + edge overlap)

**Summary**

- **Debugger → Telegram:** `sendDebuggerExceptionTelegram` in `debugger-alerts.ts` (per-scope throttle, `DEBUGGER_TELEGRAM_EXCEPTION_THROTTLE_MS`, opt-out `DEBUGGER_TELEGRAM_EXCEPTION_DISABLE`); wired from `symbol-cycle.ts` (bot cycle errors) and `middleware-factory.ts` (non-transient fatal boundary). Optional digest `info` rows via `DEBUGGER_TELEGRAM_INCLUDE_INFO=1`. **Next.js:** `lib/debugger-telegram-server.ts` + `instrumentation.ts` `onRequestError` wrapper (throttle `DEBUGGER_NEXT_TELEGRAM_THROTTLE_MS`, disable `DEBUGGER_NEXT_TELEGRAM_DISABLE`); requires server `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (or `TELEGRAM_BOT_CHAT_ID`).
- **`middleware-factory.ts`:** Default / floor `EDGE_GLOBAL_TIMEOUT_MS` **95s** (min **60s**, max **150s**) so ~35s batches are not starved by `previous_cycle_in_flight` when secrets used a 30s window.
- **`buy-helpers.ts` / `buy-context.ts`:** Paper-only softer ADX chop gate (`PAPER_MIN_ADX_CHOP_GATE`, default **14**), weighted floor relax (**7** pts, env `PAPER_WEIGHTED_FLOOR_RELAX_PCT`), HOLD-model margin **3** vs **5**, ranging MR bypass when `rawWeighted ≥ 58` and `PAPER_RANGING_MR_BYPASS` (default on).
- **`strategy.ts`:** Optional `paperExploration` path → `strategy_paper_exploration_entry` (soft micro-momentum; not used for live).
- **`cycle-decider.ts` / `index-decision.ts` / `no-trade-fallback.ts`:** Paper exploration wired; scout `paperChopRelaxed` for ranging near-BB band.
- **Tests:** `buy_context_gate_test.ts`, `strategy_paper_exploration_test.ts`; **184** passing.

---

**Summary**

- **`index-ai.ts`:** Import `withLlmConcurrency` so AI verdict no longer throws `withLlmConcurrency is not defined` (was driving `ERROR_SPIKE_RECENT`).
- **`ai-veto.ts` / `ai-veto-helpers.ts` / `ai-core.ts` / `index-ai.ts`:** Groq veto rotates across keys on 429, skips cache-hit veto by default, fast-track default **90**, AI move threshold default **0.5%**.
- **`no-trade-fallback.ts` / `index-decision.ts`:** `no_trade_strategy_scout_buy` when fallback is active and chart/AI align.
- **`debugger-error-triage.ts` / `debugger-ops-probes.ts`:** Classify resolved `safe_execute` detail; Groq rotation warn scales with key count.
- **Tests:** **180** passing. **Deploy:** `binance-bot` with JWT verification off.

---

## 2026-05-12 — Edge debugger hardening + tests

**Summary**

- **`debugger-issue-rules.ts`:** Pure issue classifiers for env gaps, error spikes, stale locks, dominant HOLD gates, and tight paper trailing exits.
- **`health-debugger.ts` / `function-health.ts` / `router.ts`:** Debugger fixes are opt-in (`debugger_apply_fixes: true`); gateway-only missing Binance creds downgrade to warn.
- **`debugger-ops-probes.ts`:** Broader paper wallet drift sample and recent tight-stop detection.
- **`debugger-auto-run.ts`:** Removed duplicate Telegram alert pass.
- **Tests:** `debugger_issue_rules_test.ts`, `debugger_config_test.ts`; updated `function_health_flags_test.ts`.
- **Deploy:** `binance-bot` redeployed; Deno suite **177** passing.

---

## 2026-05-12 — Edge batch 20 (cron runner / janitor / function health)

**Summary**

- **`batch-validator.ts` / `run-symbol-batch.ts`:** Balance-sync targets track `hasPaperMode` separately from `isLiveMode` so mixed paper+live users still reconcile paper wallets.
- **`cron-runner.ts`:** Paper wallet reconcile selects users with any paper leg, not only users with zero live bots.
- **`cron-janitor.ts`:** Exported `readReservationStaleMs` for tests.
- **Tests:** `tests/cron_janitor_test.ts`, `tests/function_health_flags_test.ts`; `run_symbol_batch_test` covers merged paper/live flags.
- **Deploy:** `binance-bot` redeployed; Deno suite **167** passing.

---

## 2026-05-12 — Edge batch 19 (cycle orchestration / batch sync)

**Summary**

- **`symbol-cycle.ts`:** After a timed-out decision phase, the cycle skips `processBot` when the abort signal is already set.
- **`run-symbol-batch.ts`:** Exported `summarizeBatchActions` and `readPostBatchBalanceSyncEnabled` for tests.
- **Tests:** `tests/batch_orchestration_test.ts` (timeout clamp, batch summary, balance-sync toggle).
- **Deploy:** `binance-bot` redeployed; Deno suite **163** passing.

---

## 2026-05-12 — Edge batch 18 (partial sell / close / fill quality)

**Summary**

- **`sell-partial.ts`:** Open-leg `value` after a partial exit uses exit mark via `resolveOpenLegRemainingValue`; partial `extra` stores sell fees.
- **`sell-fill-quality.ts`:** Fill-quality logs use `extractLegFeeUsd` for paper and live.
- **Tests:** `tests/sell_partial_state_test.ts`.
- **Deploy:** `binance-bot` redeployed; Deno suite **160** passing.

---

## 2026-05-12 — Edge batch 17 (orders / paper fill / fees / locks)

**Summary**

- **`fill-fees.ts`:** `extractLegFeeUsd` uses paper taker estimates only for paper fills; live fills without fee meta return **0**.
- **`paper-fill.ts`:** Rejects fills that round to zero base qty after lot precision.
- **Tests:** Live fee guard in `tests/fill_fees_test.ts`.
- **Deploy:** `binance-bot` redeployed; Deno suite **159** passing.

---

## 2026-05-12 — Edge batch 16 (buy prep / capital / finalize)

**Summary**

- **`buy-prep.ts`:** `notional_size_usd` in sizing meta matches post-cap notional after confidence and symbol floors.
- **`bot-buy-v2.ts` / `buy-finalize.ts`:** Trade `extra` records governance vs chart confidence and governance-scaled trade USD.
- **Tests:** Wallet/equity clamp in `tests/buy_prep_sizing_test.ts`.
- **Deploy:** `binance-bot` redeployed; Deno suite **158** passing.

---

## 2026-05-12 — Edge batch 15 (confidence policy / War Room / buy context)

**Summary**

- **`buy-context.ts`:** Weighted conviction gates use `execution_weighted_floor` (aligned with War Room and sizing).
- **`buy-warroom.ts`:** Under 1h bearish cap, raw weighted score at or above the governance floor can bypass quorum when the capped chart leg would block.
- **Tests:** `tests/war_room_consensus_test.ts`; golden-ratio bounce in `tests/buy_warroom_test.ts`.
- **Deploy:** `binance-bot` redeployed; Deno suite **157** passing.

---

## 2026-05-12 — Edge batch 14 (AI verdict / veto / decision tuning)

**Summary**

- **`index-ai.ts`:** Cheap cached-AI path runs `applyStaleSignalBuyVeto` before sentiment; `readAiPriceMoveThresholdPercent` defaults invalid env to **0.35%**.
- **`ai-core.ts`:** Gemini stale-cache fallback re-applies stale BUY veto.
- **Tests:** `tests/index_ai_move_threshold_test.ts`, `tests/decision_tuning_test.ts`.
- **Deploy:** `binance-bot` redeployed; Deno suite **153** passing.

---

## 2026-05-12 — Edge batch 13 (exchange client / bot / execution)

**Summary**

- **`bot.ts`:** `currentBalance` is mutable after partial TP; live telemetry falls back to `starting_balance` instead of paper `demo_balance`; scaffold profile after `ensureProfileRow`.
- **`exchange-client.ts`:** `baseAssetFromUsdtSymbol` for reconciler and tests.
- **`execution.ts`:** Kelly helpers documented as legacy (live sizing uses `risk-to-stop-sizing.ts`); tests in `tests/execution_sizing_test.ts`.
- **Tests:** `tests/exchange_client_helpers_test.ts` for symbol/min-notional/EMA helpers.
- **Deploy:** `binance-bot` redeployed; Deno suite **145** passing.

---

## 2026-05-12 — Edge batch 12 (cycle decision / no-trade fallback)

**Summary**

- **`no-trade-fallback.ts`:** Documented relaxation clamps (−10 AI confidence, floor 55; −2 tech, floor 3) via `computeNoTradeFallbackFloors`; tests in `tests/no_trade_fallback_test.ts`.
- **`cycle-decider.ts`:** `max_open_trades` counts only non-ghost open rows so shadow legs do not block live slots.
- **Deploy:** `binance-bot` redeployed with JWT verification off; Deno suite **138** passing.

---

## 2026-05-12 — Daily salary audit (00:00 UTC)

**Summary**

- **`scripts/daily-salary-audit/`:** Node audit (24h PnL, win rate, hold time, blockers, symbol rollup) + Telegram ITHM report.
- **`.github/workflows/daily-salary-audit.yml`:** GitHub Actions schedule at 00:00 UTC.
- **`supabase/functions/daily-salary-audit`:** Edge entry + migration `20260520120000_daily_salary_audit_cron.sql` for pg_cron.

---

**Summary**

- **`buy-helpers.ts` / `bot-shared.ts`:** meme trailing cannot be tighter than **1.5%** below the high; ATR trails widen to DB/pct floor.
- **`bot.ts`:** trailing exits persist as **`trailing_stop_hit`** (not `stoploss_hit`).
- **`buy-context.ts`:** BUY blocked when weighted conviction is below grinder floor (default **62**, env `GRINDER_MIN_WEIGHTED_CONFIDENCE`); HOLD model action blocked unless conviction clears floor + 5.

---

**Summary**

- **`senior-trader-activity.ts`:** paper/aggressive lowers AI/tech floors modestly; easier force-buy thresholds when enabled.
- **`no-trade-fallback.ts`:** paper inactivity fallback after 45m; paper fallback enables aggressive matrix paths.
- **`stop-reentry-cooldown.ts`:** paper post-stop re-entry cooldown default 3m.
- **`index-decision.ts`:** quality tie-break BUY at tech ≥7 with confidence near floor.
- **DB migration `20260513133000_senior_trader_activity.sql`:** `max_open_trades` ≥4, lower paper confidence/tech floors, aggressive on autopilot symbols.

---

**Summary**

- **`cycle-decider.ts`:** aggressive/sandbox runs invoke AI without micro-move gating; smart-filter low-volume no longer sleeps AI in aggressive paper; ranging regime no longer raises confidence above global `min_ai_confidence`.
- **`index-decision.ts`:** softer aggressive AI/tech floors for `aggressive_buy_confirmed` paths.
- **`strategy.ts`:** EMA50 tolerance + ranging pullback BUY when micro structure aligns.
- **`no-trade-fallback.ts`:** paper inactivity fallback after 2h (was 4h); relaxed floors to 48 / tech 4.
- **DB (`bot_settings`):** `min_ai_confidence` 55, ranging 54, trending 52, `min_tech_score` 5 for autopilot rows.
- **Deploy:** `binance-bot` edge function redeployed (`--no-verify-jwt`).

---

## 2026-05-12 — Live aggressive entry + gateway hub sync

**Summary**

- **`index-decision.ts`:** aggressive paper can confirm buys when AI returns `HOLD` but trend/OB/tech align; tech floor matches `min_tech_score`.
- **`strategy.ts`:** structure-recovery BUY when micro trend + volume confirm under EMA200.
- **`cycle-decider.ts`:** wide-spread smart-filter no longer blocks paper/sandbox buys.
- **Gateway scripts:** `apply-vultr-gateway.sh` mirrors stream hub into `scripts/gateway-stream-hub`; `fix-vultr-stream-hub-deno.sh` falls back to `~/gateway-stream-hub`.
- **Tests:** decision matrix aggressive fallback case (66 Deno tests).

---

## 2026-05-12 — Paper wallet reconcile + entry quality gates

**Summary**

- **`paper-wallet-reconcile.ts`:** debugger rebases `profiles.demo_balance` from `starting_balance` + paper realized PnL − open notionals (`PAPER_WALLET_RECONCILE=1` default).
- **`stop-reentry-cooldown.ts`:** 5m post-`stoploss_hit` symbol cooldown before new BUYs.
- **`trade-size-floor.ts`:** BTC min ~$50 notional; PEPE ~$25.
- **`index-decision.ts`:** removed aggressive HOLD fallback; tighter tie-breaker + order-book gate.
- **`run-symbol-batch.ts`:** force-buy needs `action=BUY` + higher confidence delta; cooldown wired pre-execution.
- **`ai-veto-helpers.ts` / `index-ai.ts`:** looser fast-veto micro-pullback defaults; fewer AI calls on small price moves.
- **`money-machine-guard.ts`:** live-tick high-water; distinct exit reasons; cron paper-wallet reconcile for active paper users.
- **`no-trade-fallback.ts`:** no longer forces aggressive mode unless `NO_TRADE_FALLBACK_FORCE_AGGRESSIVE=1`.
- **`run-symbol-batch.ts`:** paper scenario overlay uses `let snapshot` (fixes `Assignment to constant variable` on `momentum_buy` / dry-run); dry-run returns `tag: ok` so batch actions are not mislabeled `error`.
- **`health-debugger.ts`:** Binance secret check accepts `BINANCE_SECRET` / `BINANCE_API_SECRET` (not only `BINANCE_SECRET_KEY`).

---

**Summary**

- **`postgrest-errors.ts`:** classifies `PGRST002` / schema-cache outages; **`withPostgrestRetry`** on hot DB paths; Sentry fatals skip transients.
- **`trade-store.ts`:** `loadOpenTrade` + `paper_adjust_demo_balance` retry on transient PostgREST.
- **`index.ts`:** fatal boundary logs transients as `warn` (not `error`).
- **DB:** applied `bot_settings.min_profit_after_fees_pct` on `emviaygygylosvmtsvlq` (API + Edge gate already wired).

---

## 2026-05-11 — Confidence-scaled BUY size (risk % base)

**Summary**

- **`trade-size-confidence.ts`:** scales BUY notional from blended AI + weighted confidence between **`CONFIDENCE_SIZE_MIN_SCALE`** (default `0.75`) and **`CONFIDENCE_SIZE_MAX_SCALE`** (default `1.4`) above the regime `min_ai_confidence` floor; fixed `trade_size_usd` / `TRADING_AMOUNT` bypass scaling.
- **`buy-context.ts`:** applies confidence sizing after `risk_percent` base; MTF half-size still stacks via `executionUsdScale`.
- **`trade-store.ts`:** PEPE no longer hard-capped at **`PEPE_TEST_TRADE_USD`** when size is unset — uses **`risk_percent`** like other symbols.
- **`run-symbol-batch.ts`:** removed legacy `resolveConfidenceTierRiskPercent` row override (avoid double-sizing).

---

## 2026-05-11 — Telegram wallet on cron digest + reliable `/status`

**Summary**

- **`telegram-wallet-summary.ts`:** shared balance / PnL loader and digest formatting.
- **`cron-telegram-digest.ts`:** each cron digest prepends balance, account PnL, and realized PnL (disable with **`TELEGRAM_CRON_DIGEST_WALLET=0`**).
- **`telegram-poll.ts`:** Telegram **`getUpdates`** uses persisted **`poll_offset`** so **`/status`** / **`/wallet`** are not dropped from the 10-update window.
- **`index.ts`:** wallet command handling runs at batch start and end (before digest).
- **Tests:** digest section + status message formatting in **`tests/telegram_wallet_status_test.ts`**.

---

## 2026-05-11 — Edge ops bundle (locks RLS, observe, tests, binance split)

**Summary**

- **`trade_execution_locks`:** migration `20260518120000_trade_execution_locks_rls.sql` — RLS on; revoke `anon`/`authenticated` (service-role Edge only).
- **`exec-observe.ts`:** opt-in `EXEC_OBSERVE=1` structured logs for locks, paper ticker null, sell fill qty mismatch, create-order idempotent skips.
- **`binance-create-preflight.ts` / `binance-paper-order.ts`:** idempotency + lock claim and paper `createOrder` path split out of `binance.ts`.
- **`market-data-timeout.ts`:** bounded CCXT timeout per snapshot fetch with restore on shared public exchange instance.
- **`trade-execution-lock-config.ts`:** tunable stale/prune parsing + Deno unit tests; **`paper-fill-baseline.ts`** for paper book baseline tests.
- **`docs/EDGE_OPERATIONS.md`**, **`npm run check`**, **`.github/workflows/ci.yml`** (lint + tsc + Deno tests).

---

## 2026-05-10 — Telegram: one alert per action, less trailing noise

**Summary**

- **BUY / full SELL:** Prefer **one** human-readable Telegram per fill (`buy-finalize`, `bot-sell` + `closeTradeRowAfterSell({ skipTradeRowTelegram: true })`); **`insertTrade`** supports **`skipTradeRowTelegram`** so the DB insert path does not also fire **`sendTradeRowNotification`**.
- **PARTIAL SELL:** **`sell-partial.ts`** no longer sends a separate **`sendTradeRowNotification`** before the main partial-sell Telegram (one message only).
- **Trailing high-watermark DB sync:** **`sendTradeRowNotification`** on every trailing persist is **off by default** (was very noisy). Opt in with **`TELEGRAM_TRAILING_ROW_UPDATE=1`** or **`VERBOSE_DB_LOGS=1`** (`log-policy.ts` + `bot.ts`).
- **HOLD heartbeats:** Per-symbol HOLD Telegram remains behind **`TELEGRAM_HOLD_HEARTBEAT=1`** (see earlier **`log-policy`** work).
- **Cron digest:** **`maybeSendCronDigestTelegram`** can be **fire-and-forget** from **`index.ts`** so Telegram RTT does not extend the Edge response as much; throttle with **`TELEGRAM_CRON_DIGEST_MS`** if needed.

---

## 2026-05-10 — Veto freshness + net TP after fees

**Summary**

- **`ai-veto.ts` + `ai-veto-helpers.ts`:** Groq veto payload is **`veto_window`**: last five **1m** and **15m** OHLCV bars plus computed short-horizon returns. **Fast path** (on by default, **`VETO_STALE_SIGNAL=0`** to disable) rejects before Groq on sharp 1m deterioration (`VETO_FAST_1M_5BAR_RETURN_PCT`, **`VETO_FAST_GAP_FROM_LAST_1M_CLOSE_PCT`**, three red 1m bars).
- **`bot_settings.min_profit_after_fees_pct`:** migration `20260510180000_bot_settings_min_profit_after_fees.sql` — BUY blocked when estimated net TP (`take_profit_pct` minus round-trip taker %) is below the floor (null → **`DEFAULT_MIN_PROFIT_AFTER_FEES_PCT`** default `0.15`; column **`0`** disables). Gate off with **`MIN_PROFIT_AFTER_FEES_GATE=0`**.
- **`constants.ts` / `paper-fill.ts`:** **`PAPER_TAKER_FEE_PCT`** env drives per-leg taker fee (default `0.001`) so paper round-trip matches the net-TP gate.
- **`ai-llm-concurrency.ts`:** Gemini + Groq veto share **`withLlmConcurrency`** — **`LLM_MAX_CONCURRENT`** (default **2**, clamp 1–8).
- **`index.ts`:** Multi-symbol path uses **`Promise.allSettled`** per symbol; TradingView webhook auth via **`TRADINGVIEW_WEBHOOK_SECRET`** + **`tv_webhook`/`tv_secret`** + symbol (see bullets in repo `index.ts`); **`lite_cycle`** skips stale-trade + retention for a shorter hot path.
- **`bot.ts`:** Comment points parallel work to **`run-symbol-batch.ts`** / **`index.ts`**.

---

## 2026-05-18 — Paper/live execution parity (fees, bid/ask, locks)

**Summary**

- **`constants.ts`:** **`resolvePaperTakerFeeSimulationPct`** clamps **`PAPER_TAKER_FEE_PCT`** to **0.1%–0.2% per leg** (paper + net-TP math). Extra spread sim: **`PAPER_SPREAD_EXTRA_SIM_BPS`** (default **5** = 0.05%).
- **`public-ticker.ts` + `paper-fill.ts`:** Paper/ghost fills use **public `fetchTicker` bid/ask** (buy → ask, sell → bid), then regime slippage + extra bps; metadata records `book_baseline_source`.
- **`binance.ts`:** **`trade_execution_locks`** claim before exchange/paper order (with **`bot_id` + `cycle_id`**); release on paper/live order failure; buy lock released after **`insertTrade`** in **`buy-finalize.ts`**; sell lock after fill-quality log in **`bot-sell.ts`**. **`bot-buy-v2`** catch releases if finalize fails after a non-idempotent fill.
- **Migration:** `20260517120000_trade_execution_locks.sql`.
- **`strategy.ts`:** Comment clarifies indicator price vs execution layer.

---

## 2026-05-17 — Smaller `public.logs` writes (Edge)

**Summary**

- New **`log-policy.ts`**: by default **stop** high-volume inserts — **`decision-trace`** + **`cycle-summary`** (enable with **`DECISION_TRACE_DB_LOGS=1`** or **`VERBOSE_DB_LOGS=1`**), **`bot-cycle`** hold/skip rows from telemetry (**`TELEMETRY_BOT_CYCLE_LOG_ON_HOLD=1`** or verbose), **`bot-skip`** (**`BOT_SKIP_DB_LOGS=1`**), **`cron_batch_start`** (**`LOG_CRON_BATCH_START=1`**, default now **off**), **`ai` cache-hit** (**`AI_CACHE_HIT_DB_LOGS=1`**), **Gemini/Groq key success** info rows (**`AI_KEY_SUCCESS_DB_LOGS=1`**). **`execution-outcome`** stays on unless **`EXECUTION_OUTCOME_DB_LOGS=0`**. Errors / execution-quality / rate limits / key rotation (warn) unchanged.

---

## 2026-05-16 — Cron auth without `ALTER DATABASE`

**Summary**

- **42501:** Supabase SQL Editor often cannot run `alter database … set app.cron_secret`. Migration `20260516120000_cron_bot_secret_table.sql` adds **`public.bot_cron_http_secret`** (single row) + **`invoke_binance_bot_edge_heartbeat()`** (`SECURITY DEFINER`) and reschedules **`bot-heartbeat-all-symbols`** to call it. **One-time:** `insert into public.bot_cron_http_secret (id, secret) values (1, '<same as Edge BOT_SECRET>') on conflict (id) do update set secret = excluded.secret, updated_at = now();`

---

## 2026-05-15 — Telegram diagnostics

**Summary**

- **Cron gate:** `handleAuthenticatedCron` no longer requires **`TELEGRAM_BOT_TOKEN`** to run the bot — only **`GEMINI_API_KEY`** is mandatory. Missing Telegram only disables alerts (was blocking the whole cycle if token was unset in Edge).
- **`notifier.ts`:** Accept **`TELEGRAM_BOT_CHAT_ID`** as alias for chat id; on Telegram **400 parse errors**, retry **plain text** (no `parse_mode`); failures also write **`logs`** (`source=telegram`, `message=telegram_send_failed`) for dashboard visibility.
- **Manual test:** POST body **`{"telegram_ping":true}`** with valid **`x-binance-bot-secret`** sends one test message (no symbols required).
- **Cron digest:** New module `cron-telegram-digest.ts` — default **`TELEGRAM_CRON_DIGEST=1`** sends a short **multi-symbol summary** Telegram at most every **`TELEGRAM_CRON_DIGEST_MS`** (default **10 min**) when the cron run actually scanned bots, so you see activity beyond `telegram_ping` / rare trade alerts. Set **`TELEGRAM_CRON_DIGEST=0`** to disable.

---

## 2026-05-13 — Paper equity race fix (parallel symbols)

**Summary**

- **Bug:** Cron runs **one Edge invocation per symbol in parallel** (`Promise.all` in `index.ts`). Paper mode **skipped** `reserve_buy_capital`, and `currentBalance` preferred **`account_balances`** telemetry rows over **`profiles.demo_balance`** — so concurrent BTC/SOL/PEPE batches could **double-count** wallet cash or drift vs realized `trades.pnl`.
- **Fix:** Paper/live routing — **`resolveExchangeSkipped(row)`** uses **`profiles.demo_balance` only** for paper/ghost balance reads. **`reserve_buy_capital`** gains **`p_use_profile_demo_only`** (true for paper buys). **`paper_adjust_demo_balance`** RPC applies **locked atomic deltas** to `demo_balance` on paper/ghost BUY/SELL (replacing last-write-wins absolute updates). Migration `20260513120000_paper_balance_atomic.sql`.
- **Live parity:** `buy-prep.ts` uses **`resolveTestMode(row)`** (from **`is_live_trading_enabled`**) instead of legacy **`is_test_mode`** for **`getUsdtBalance`** and returned **`isTestMode`**, so enabling live Binance routes real spot USDT for the same buy pipeline as paper routes simulated wallet + `demo_balance`.
- **Deploy / ops:** Remote DB updated with **`reserve_buy_capital` (5-arg)** + **`paper_adjust_demo_balance`**; **`binance-bot`** deployed with **`--no-verify-jwt`**. **`logs`:** one-shot delete of rows **not** matching the `prune_logs_non_essential` keep-list (~3106 rows removed); errors/warns and execution/cycle traces retained.
- **DB load:** `persistRunTelemetry` skips **`account_balances`** inserts on **HOLD/SKIP** by default (minute cron × symbols was flooding rows). Edge secret **`TELEMETRY_ACCOUNT_BALANCE_ON_HOLD=1`** restores old behavior. **`VACUUM ANALYZE logs`** + **`purge_internal_cron_and_net_http_retention()`** run when relieving pressure.

---

## 2026-05-12 — Cron fan-out fix (connection timeouts)

**Summary**

- **Root cause of SQL timeouts:** Legacy `setup-cron.sql` scheduled **six** `pg_cron` jobs every minute (two per symbol with `pg_sleep`), hammering Edge + Postgres. Migration `20260512100000_consolidate_cron_batch_prune.sql` **unschedules** those six jobs and adds **one** job `bot-heartbeat-all-symbols` posting `{"symbols":["BTCUSDT","SOLUSDT","PEPEUSDT"]}` once per minute (same behavior Edge already supports).
- **Prune hardening:** `prune_logs_non_essential` rewritten as **batched deletes** (8000 rows per loop) with `statement_timeout = 600s` locally so a huge `logs` table cannot wedge the database in one transaction.

---

## 2026-05-10 — Selective log retention, cron overlap guard

**Summary**

- **DB:** New migration `20260510180000_prune_logs_non_essential.sql` adds `public.prune_logs_non_essential(p_min_age_hours)` (keeps errors/warns, execution-quality, decision/cycle summary, war-room, fills, health, stale-trade alerts; drops aged noise such as per-tick `runtime` spam). Daily pg_cron `daily-prune-noisy-logs` at 03:25 UTC. Edge retention (`health-check.ts`) now calls this RPC instead of deleting **all** logs older than N days.
- **Edge:** One `cron_batch_start` row per batch instead of three `function_started` rows per cron. **Overlap guard fixed:** `inFlightCycleStartedAt` clears only when `handleAuthenticatedCron` finishes (not when the 90s timeout response is returned), so overlapping crons do not pile up while work is still running.
- **DB load (2026-05-11):** `runStaleTradeGuard` throttled to default **15 min** per warm isolate (`STALE_TRADE_GUARD_INTERVAL_MS`). Optional `LOG_CRON_BATCH_START=0` disables the per-batch `cron_row` insert. Migration `idx_logs_created_at` for faster prunes. `scripts/emergency-db-relief.sql` for manual relief when the project is resource-bound.

---

## 2026-05-06 (afternoon) — Modular split, paper-fill exit-px bug, throttle bug

**Summary**

- **Paper-fill exit price bug (real money issue).** `bot-sell.ts` was reading the simulated fill `average`/`price` only when `!exchangeSkipped`. In paper mode `exchangeSkipped=true`, so the new `simulatePaperFill` fee + slippage was created but **discarded** — `exitPx` stayed at the snapshot price. Paper PnL was still optimistic vs live. Fixed: read `(sellOrder).average ?? .price` in both branches (paper and live return the same shape now).
- **Key-rotation throttle bug.** `emitThrottledKeyRotation` reset `count` to `0` after every flush, so the next hit's `count` rose to `1`, the `count > 1` guard never tripped, and **every rotation still emitted** (defeating the throttle). Rewrote around a `lastEmitMs` lock with `suppressed_in_prev_window` carried into the next flush — at most one row per `provider:keyIndex` per 60s now.
- **Modular split (300-line rule).** `bot-sell.ts` 404 → 298 lines (extracted `applyBreakEvenTrigger` to `sell-break-even.ts`, re-exported for callers). `bot-buy.ts` 1465 → 1099 lines (extracted helpers/MTF/logging into `buy-helpers.ts`, `buy-mtf.ts`, `buy-logging.ts`). The remaining `executeBuyFlow` is one logical unit (gates → sizing → order → record); splitting further would require threading 30+ closures through helper signatures and is left as logged tech debt.
- **Deploy verified.** Edge function deployed at 07:03 UTC — new modules resolved cleanly. Post-deploy DB scan shows zero `*_key_rotated` rows in 5min (throttle holding) and the gates from earlier today still firing (`bot-skip`, `war-room-ghost`).
- **Known minor issue (not fixed).** `effectiveExitReason` stays at the strategy `exit_reason` (often `"hold"`) when `decideHybridMatrix` triggers SELL via AI panic / order-book imbalance / strategy-signal-sell — recorded `exit_reason` is misleading in those cases. Cosmetic only (no PnL impact); fix requires extending the `ExitReason` enum.

---

## 2026-05-06 — Money-machine hygiene: paper === live, ATR TP/SL, log diet

**Summary**

- **Killed double-row bug.** `bot-sell.ts` no longer inserts a sibling `type='sell'` ledger row on close — the BUY row's UPDATE (status / exitPrice / pnl / pnlPercent / closed_at / exit_reason) is the canonical record. Old per-trade pairs in `trades` inflated PnL/turnover ~2x and `total_trades` in dashboards.
- **Paper === Live.** New `paper-fill.ts` (`simulatePaperFill`) returns the same shape as `executeSmartLimitChaser` and applies real Binance behavior to test orders: Spot taker fee 0.1%, regime-keyed slippage (TRENDING 4 bps / NEUTRAL 6 / RANGING 8), `formatAmount` lot precision, `normalizePriceForSymbol` tick precision. `binance.ts createOrder` test branch now routes through it; flipping `is_live_trading_enabled=true` only changes the routing target (CCXT instead of mock).
- **ATR-based TP + R:R floor.** `bot-buy.ts` adds `takeProfitDistanceUp(...)` so TP distance = `max(2.5×ATR, take_profit_pct × entry, 2.0 × SL_distance)`. With static `take_profit_pct=1.5` and `stop_loss_pct=1.0`, only 2 of 186 closed trades hit ROI in 14d; the new floor guarantees ≥2:1 reward:risk.
- **Regime/ADX entry gate.** New `MIN_ADX_FOR_NON_TRENDING_BUY=18` skip in `bot-buy.ts`: refuse BUY when `regime != TRENDING` AND `adx14 < 18`. Backtest showed avg loss ~2× avg win in low-ADX windows.
- **Settings tightened (DB).** `bot_settings`: `min_ai_confidence` 60→**70**, `min_ai_confidence_trending` **65**, `min_ai_confidence_ranging` **75**, `min_tech_score` 4→**6**, `take_profit_pct` 1.5→**3.0** (fallback only; ATR is primary), `max_open_trades` 3→**2**.
- **Log diet.** `ai-db.ts` `logGeminiKeyLimit` / `logGroqKeyLimit` now share `emitThrottledKeyRotation(...)` with a 60s in-memory window per `provider:key`, emitting one aggregated row instead of every rotation. Last run had ~34k key-rotation rows in 7d (~35% of `public.logs`).
- **DB hygiene.** `DROP INDEX ai_cache_symbol_created_at_idx` (duplicate). All 16 `auth_rls_initplan` policies on `account_balances` / `bot_settings` / `logs` / `profiles` / `trades` / `user_demo_workspaces` / `war_room_audits` rewritten with `(select auth.uid())` / `(select auth.role())`. New `pg_cron` job `daily-bot-log-cleanup` (`15 3 * * *`): logs >7d, `bot_debug_traces` >3d, `war_room_audits` >14d, `account_balances` >30d.
- **Cleanup pass.** Manual delete of 33,856 Groq key-limit warn rows + 2,351 stale `bot_debug_traces` (>3d) + `VACUUM ANALYZE`.
- **Risk note.** All changes are paper-mode safe (`is_live_trading_enabled=false`). Flip live only after seeing positive PnL ≥3 days with the new gates active.

---

## 2026-05-03 — AI verdict latency (Gemini queue + LLM timeouts)

**Summary**
- **Root cause**: `ai_verdict` time included (a) a **global queue** around the whole Gemini path **including Groq BUY veto**, so N parallel symbols stacked wall-clock; (b) **unbounded `fetch`** to Gemini/Groq/OpenAI on slow/hung responses.
- **Fix**: Serialize only **`geminiAnalyze` HTTP** (`withGeminiHttpSerialized` in `ai-core.ts`); Groq veto, Groq primary, and OpenAI run **outside** that mutex. Per-request caps via **`mergeLlmAbortSignal`** + env: **`GEMINI_REQUEST_TIMEOUT_MS`** (default 12s), **`GROQ_REQUEST_TIMEOUT_MS`** (10s), **`GROQ_VETO_TIMEOUT_MS`** (8s), **`OPENAI_REQUEST_TIMEOUT_MS`** (14s) in `ai-models.ts` / `ai-veto.ts`. Gemini **AbortError** / timeout → try next key instead of hard stop.
- **Logging**: `[PERF] ai_verdict slow` default warn moved **6s → 18s** (`PERF_AI_VERDICT_WARN_MS`); bot loop latency warn default **10s → 30s** (`BOT_LOOP_LATENCY_WARN_MS`).

---

## 2026-05-03 — Order-book imbalance exit + ghost `demo_balance`

**Summary**
- **Order Book Imbalance Exit** was firing when `imbalanceRatio < 0.4` with no minimum hold → noisy book could close a position almost immediately. Defaults are now **`imbalanceRatio < 0.32`**, **`90s`** minimum time after `opened_at`, and Edge env overrides **`ORDER_BOOK_IMBALANCE_EXIT_BELOW`**, **`ORDER_BOOK_IMBALANCE_MIN_HOLD_MS`** (wired in `run-symbol-batch.ts` → `decideHybridMatrix` in `index-decision.ts`).
- **`formatCycleReason`** moved to **`index-decision-format.ts`** so `index-decision.ts` stays under the line limit.
- Ghost/paper: **`profiles.demo_balance`** is updated on BUY/SELL when **`isTestMode || ghostMode`** (`bot-buy.ts` / `bot-sell.ts`); ghost BUY/SELL **`nextBalance`** uses the same cent-based debit/credit as non-ghost paths.

---

## 2026-05-03 — Gemini 429 / duplicate cooldown logs (multi-symbol)

**Summary**
- Serialized **Gemini HTTP** per isolate (`ai-core.ts` `withGeminiHttpSerialized`;
  later refined — see **AI verdict latency** entry) so parallel batches do not
  hammer the same Gemini key → fewer duplicate **429 → key #N cooldown** lines.
- `[PERF] ai_verdict slow` now warns only above **6s** by default (override with
  Edge env **`PERF_AI_VERDICT_WARN_MS`**, min 1500).

---

## 2026-05-03 — Per-bot cycle timeout (fixes `CYCLE_ABORTED:llm`)

**Summary**
- Raised default **`BOT_CYCLE_TIMEOUT_MS`** from **8s → 55s** (each symbol’s bot run is parallel; LLM + veto + OHLCV was exceeding 8s).
- Optional Edge secret **`BOT_CYCLE_TIMEOUT_MS`** (integer ms, clamped **10_000–120_000**) overrides default.

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

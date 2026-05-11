// @ts-nocheck
/**
 * One symbol filter (e.g. BTCUSDT): load autopilot rows, run all user bot cycles,
 * return actions + balance-sync targets. Isolated so multi-symbol runs can
 * Promise.allSettled without cross-symbol failure.
 */
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { BotActionResult, DebugRawAiResponse } from "./types.ts";
import { botDebug, botError } from "./bot-debug.ts";
import {
  applyBinanceCycleJitter,
  fetchIndicatorSnapshot,
  getTotalAccountBalanceUsdt,
} from "./binance.ts";
import { decideTechnicalSignal } from "./indicators.ts";
import { processBot } from "./bot.ts";
import { loadOpenTrade, updateProfileBalance } from "./trade-store.ts";
import {
  calculateTechnicalScore,
  checkEntryConditions,
  checkExitConditions,
} from "./strategy.ts";
import { evaluateMoneyMachineExits } from "./money-machine-guard.ts";
import { decideHybridMatrix } from "./index-decision.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import { resolveNoTradeFallback } from "./no-trade-fallback.ts";
import { resolveDemoPaperProbeBuy } from "./demo-paper-probe-buy.ts";
import {
  resolveSessionAwareMinAiConfidence,
  resolveVolumeSpikeMultiplier,
} from "./decision-tuning.ts";
import { logCycleSummary, logDecisionTrace, logExecutionOutcome } from "./index-logging.ts";
import {
  getAiVerdict,
  getCachedSnapshot,
  isEmergencyAbortQuotaError,
  shouldRunAiCheck,
} from "./index-ai.ts";
import {
  resolveGhostMode,
  resolveTestMode,
  setActiveTelegramCycleId,
} from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { DEFAULT_SYMBOL } from "./constants.ts";
import {
  formatUnknownError,
  normalizeSymbol,
  resolveMinAiConfidenceForRegime,
  resolveMinTechScore,
  resolveMinVolume24hQuote,
  toFixedNoExponents,
  toNumber,
  toStringValue,
} from "./utils.ts";
import {
  collectPreflightVetoChecks,
  formatVetoDetailsPayload,
  insertWarRoomAudit,
  tryMtfOnlyHighConfidenceHalfBuy,
} from "./veto-transparency.ts";
import { evaluateSmartNoiseFilter } from "./smart-filter.ts";

export type SymbolBatchResult = {
  symbolFilter: string;
  actions: BotActionResult[];
  balanceSyncTargets: Map<string, { isLiveMode: boolean; symbols: Set<string> }>;
  cycleEmergencyAbort: boolean;
  cycleId: string;
  allSettledElapsedMs: number;
  scanned: number;
};

/** Per-bot wall time (snapshot + strategy + Gemini/Groq). 8s was aborting real LLM calls (`CYCLE_ABORTED:llm`). */
function readBotCycleTimeoutMs(): number {
  const raw = String(Deno.env.get("BOT_CYCLE_TIMEOUT_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 55_000;
  return Math.min(120_000, Math.max(10_000, Math.floor(n)));
}
const BOT_CYCLE_TIMEOUT_MS = readBotCycleTimeoutMs();

function hasValidNonZeroEma(snapshot: {
  emaFast: number;
  emaSlow: number;
  ema200: number;
}) {
  return Number.isFinite(snapshot.emaFast) &&
    Number.isFinite(snapshot.emaSlow) &&
    Number.isFinite(snapshot.ema200) &&
    snapshot.emaFast > 0 &&
    snapshot.emaSlow > 0 &&
    snapshot.ema200 > 0;
}

export async function runSymbolBatch(params: {
  supabase: ReturnType<typeof createClient>;
  symbolFilter: string;
  lastAiPriceBySymbol: Map<string, number>;
  marketCache?: Map<string, import("./types.ts").IndicatorSnapshot>;
}): Promise<SymbolBatchResult> {
  const { supabase, symbolFilter, lastAiPriceBySymbol, marketCache } = params;

  const botsQuery = await safeExecute(
    "db_bot_settings_for_symbol",
    async () => {
      const r = await supabase
        .from("bot_settings")
        .select("*")
        .eq("is_autopilot_enabled", true)
        .eq("symbol", symbolFilter);
      if (r.error) throw r.error;
      return r;
    },
    { data: [] as unknown[], error: null as null },
  );
  const activeBots = (botsQuery.data ?? []) as unknown[];
  console.log("DB_CHECK:", {
    sym: symbolFilter,
    bots: activeBots?.length ?? 0,
    err: botsQuery.error ? 1 : 0,
  });

  if (!activeBots?.length) {
    return {
      symbolFilter,
      actions: [],
      balanceSyncTargets: new Map(),
      cycleEmergencyAbort: false,
      cycleId: crypto.randomUUID(),
      allSettledElapsedMs: 0,
      scanned: 0,
    };
  }

  const symbolCache = marketCache ?? new Map();
  const btcSnapshot = await safeExecute(
    "market_snapshot_BTCUSDT",
    () => getCachedSnapshot(symbolCache, "BTCUSDT", fetchIndicatorSnapshot),
    null,
  );
  const btcRsi = Number(btcSnapshot?.rsi ?? NaN);
  const btcOverbought = Number.isFinite(btcRsi) && btcRsi > 70;
  const actions: BotActionResult[] = [];
  let cycleEmergencyAbort = false;
  const balanceSyncTargets = new Map<string, { isLiveMode: boolean; symbols: Set<string> }>();
  const cycleId = crypto.randomUUID();
  botDebug("index", "cron_cycle_id", { cycleId, symbol: symbolFilter, bots: activeBots.length });

  for (const row of activeBots) {
    const uid = toStringValue((row as any).user_id) ?? "unknown";
    if (uid === "unknown") continue;
    const sym = normalizeSymbol((row as any).symbol, DEFAULT_SYMBOL);
    const previous = balanceSyncTargets.get(uid) ?? {
      isLiveMode: false,
      symbols: new Set<string>(),
    };
    previous.isLiveMode =
      previous.isLiveMode || (!resolveTestMode(row) && !resolveGhostMode(row));
    previous.symbols.add(sym);
    balanceSyncTargets.set(uid, previous);
  }

  const runSingleBotCycle = async (row: any, botIndex: number, signal: AbortSignal) => {
    const userId = toStringValue(row.user_id) ?? "unknown";
    const symbol = normalizeSymbol(row.symbol, symbolFilter);
    let demoProbeBuyFlag = false;
    botDebug("index", "bot_cycle_start", { userId, symbol, botIndex });
    let minAiConfidence = resolveMinAiConfidenceForRegime(
      row as Record<string, unknown>,
      "NEUTRAL",
    );

    try {
      await applyBinanceCycleJitter();
      const snapshot = await safeExecute(
        `market_snapshot_${symbol}`,
        () => getCachedSnapshot(symbolCache, symbol, fetchIndicatorSnapshot, signal),
        null,
      );
      if (!snapshot) {
        throw new Error(`SNAPSHOT_UNAVAILABLE:${symbol}`);
      }
      minAiConfidence = resolveMinAiConfidenceForRegime(
        row as Record<string, unknown>,
        String(snapshot.marketRegime ?? "NEUTRAL"),
      );

      console.log("[DATA]:", {
        symbol,
        price: snapshot.latestPrice,
        rsi: snapshot.rsi,
        emaFast: snapshot.emaFast,
        emaSlow: snapshot.emaSlow,
        ema200: snapshot.ema200,
        regime: snapshot.marketRegime,
        adx14: snapshot.adx14,
      });

      if (!hasValidNonZeroEma(snapshot)) {
        await captureTraceReasonOnly({
          supabase,
          userId: toStringValue((row as any)?.user_id) ?? null,
          botId: toStringValue((row as any)?.id) ?? null,
          cycleId,
          symbol,
          decision: "HOLD",
          reason: "CRITICAL_INDICATOR_ZERO",
          perfMetadata: { is_timeout: false },
        });
        await supabase.from("logs").insert([{
          user_id: toStringValue((row as any)?.user_id) ?? null,
          symbol,
          level: "error",
          source: "market-data",
          message: "critical_indicator_invalid",
          meta: {
            event: "critical_indicator_invalid",
            symbol,
            emaFast: snapshot.emaFast,
            emaSlow: snapshot.emaSlow,
            ema200: snapshot.ema200,
            action: "execution_stopped",
          },
          created_at: new Date().toISOString(),
        }]);
        return { tag: "critical" as const, error: new Error(`CRITICAL_INDICATOR_ZERO:${symbol}`) };
      }

      if (!Number.isFinite(snapshot.latestPrice) || snapshot.latestPrice <= 0) {
        await captureTraceReasonOnly({
          supabase,
          userId: toStringValue((row as any)?.user_id) ?? null,
          botId: toStringValue((row as any)?.id) ?? null,
          cycleId,
          symbol,
          decision: "HOLD",
          reason: "CRITICAL_PRICE_ZERO",
          perfMetadata: { is_timeout: false },
        });
        await supabase.from("logs").insert([{
          user_id: toStringValue((row as any)?.user_id) ?? null,
          symbol,
          level: "error",
          source: "market-data",
          message: "critical_price_zero",
          meta: {
            event: "critical_price_zero",
            symbol,
            latest_price: snapshot.latestPrice,
            action: "execution_stopped",
          },
          created_at: new Date().toISOString(),
        }]);
        return { tag: "critical" as const, error: new Error(`CRITICAL_PRICE_ZERO:${symbol}`) };
      }

      const strategyEntry = checkEntryConditions(snapshot);
      const dbLoadOpenTradeStarted = performance.now();
      const openTrade = await safeExecute(
        `db_load_open_trade_${symbol}`,
        () => loadOpenTrade(supabase, row.user_id, symbol, toStringValue(row.id) ?? undefined),
        null,
      );
      const dbLoadOpenTradeMs = Math.round(performance.now() - dbLoadOpenTradeStarted);
      if (dbLoadOpenTradeMs > 500) {
        console.warn(
          `[PERF] db_load_open_trade slow ${dbLoadOpenTradeMs}ms symbol=${symbol} user=${userId}`,
        );
      }
      const strategyExit = checkExitConditions(
        openTrade,
        snapshot,
        toNumber(row.take_profit_pct, NaN),
      );
      const isTestMode = resolveTestMode(row);
      let effectiveStrategyExit =
        isTestMode && strategyExit.exit_reason === "rsi_overbought"
          ? { shouldExit: false, exit_reason: "hold" as const }
          : strategyExit;
      const mm = evaluateMoneyMachineExits({
        openTrade,
        price: snapshot.latestPrice,
      });
      if (mm.forceExit) {
        effectiveStrategyExit = {
          shouldExit: true,
          exit_reason: "stoploss_hit",
        };
      }
      if (mm.reason) {
        console.log("[MONEY_MACHINE]", { symbol, ...mm });
      }
      const technical = decideTechnicalSignal(
        snapshot.rsi,
        snapshot.emaFast,
        snapshot.emaSlow,
        snapshot.latestPrice,
        row,
      );
      const technicalScore = calculateTechnicalScore(snapshot);
      let aggressiveModeEnabled = Boolean((row as any).is_aggressive_mode);
      let minTech = resolveMinTechScore(row as Record<string, unknown>);
      const minVolume24hQuote = resolveMinVolume24hQuote(row as Record<string, unknown>);
      const isGhostExecution = resolveGhostMode(row);
      const isSandboxMode = isTestMode || isGhostExecution;
      let shouldInvokeAi = aggressiveModeEnabled
        ? shouldRunAiCheck(snapshot, lastAiPriceBySymbol)
        : technicalScore >= 3 &&
          shouldRunAiCheck(snapshot, lastAiPriceBySymbol);
      if (mm.skipAi) {
        shouldInvokeAi = false;
      }
      const bbRange = snapshot.bbUpper - snapshot.bbLower;
      const bbPosition = Number.isFinite(bbRange) && bbRange > 0
        ? (snapshot.latestPrice - snapshot.bbLower) / bbRange
        : 0;
      const lastCandle = snapshot.candles5?.at(-1);
      const smartNoise = evaluateSmartNoiseFilter({
        snapshot,
        lastCandleVolume: Number(lastCandle?.volume ?? 0),
        hasOpenTrade: Boolean(openTrade),
        isGhostExecution,
      });
      if (smartNoise.sleepAi) {
        shouldInvokeAi = false;
        console.log("[SMART_FILTER]", {
          symbol,
          userId,
          sleep_ai: 1,
          volume_1m: smartNoise.volume1m,
          avg_1m_from_24h: smartNoise.avgVolume1mFrom24h,
        });
      }
      const volumeSpikeMultiplier = resolveVolumeSpikeMultiplier(symbol);
      const volumeSpike = Boolean(
        Number(snapshot.avgVolume1m) > 0 &&
        Number(lastCandle?.volume ?? 0) >= Number(snapshot.avgVolume1m) * volumeSpikeMultiplier
      );
      const sessionAware = resolveSessionAwareMinAiConfidence({
        baseMinAiConfidence: minAiConfidence,
        avgVolume1m: Number(snapshot.avgVolume1m),
        lastCandleVolume: Number(lastCandle?.volume ?? 0),
      });
      minAiConfidence = sessionAware.adjustedMinAiConfidence;
      const noTradeFallback = await resolveNoTradeFallback({
        supabase,
        userId,
        symbol,
        hasOpenTrade: Boolean(openTrade),
        minAiConfidence,
        minTechScore: minTech,
      });
      if (noTradeFallback.active) {
        minAiConfidence = noTradeFallback.adjustedMinAiConfidence;
        minTech = noTradeFallback.adjustedMinTechScore;
        aggressiveModeEnabled = aggressiveModeEnabled || noTradeFallback.forceAggressiveMode;
        console.log("[NO_TRADE_FALLBACK]", {
          symbol,
          userId,
          days_since_last_buy: noTradeFallback.daysSinceLastBuy,
          adjusted_min_ai_confidence: minAiConfidence,
          adjusted_min_tech_score: minTech,
          force_aggressive: noTradeFallback.forceAggressiveMode ? 1 : 0,
        });
      }

      const strategySignal =
        !openTrade && strategyEntry.signal === "SELL"
          ? "HOLD"
          : strategyEntry.signal;
      const strategyFailDetail = strategyEntry.signal === "BUY"
        ? null
        : `FAIL_STRATEGY:${String(strategyEntry.strategy_fail_detail ?? "NO_BUY")}`;
      const preflight = collectPreflightVetoChecks({
        snapshot,
        technicalScore,
        aggressiveModeEnabled,
        strategySignal,
        minTechnicalScore: minTech,
        minVolume24hQuote,
        isSandboxMode,
        isGhostExecution,
      });
      if (noTradeFallback.active) {
        preflight.veto_reasons.push(
          `NO_TRADE_FALLBACK_ACTIVE:${String(noTradeFallback.reason ?? "active")}`,
        );
      }
      if (smartNoise.vetoReasons.length) {
        preflight.veto_reasons.push(...smartNoise.vetoReasons);
      }
      console.log(
        `[VETO_CHECK] Symbol: ${symbol} | Passed: ${preflight.passedCount}/${preflight.totalGates} | Fails: ${JSON.stringify(preflight.veto_reasons)}`,
      );
      console.log(
        `📊 [SCORECARD] ${symbol}: ${preflight.passedCount}/${preflight.totalGates} Gates Passed.`,
      );
      if (preflight.veto_reasons.length > 0) {
        const failedGates = Object.entries(preflight.scorecard)
          .filter(([, ok]) => !ok)
          .map(([k]) => k);
        console.log(
          `🚫 [VETOED] ${symbol}: ${preflight.veto_reasons.join(", ")} | failed_gates=${failedGates.join(",")}`,
        );
      }

      const safetyAi = {
        ai_confidence: 0,
        trend: "neutral" as const,
        trend_alignment: false,
        action: "HOLD" as const,
        groq_verdict: undefined,
        groq_reason: undefined,
      };

      const aiVerdictStarted = performance.now();
      const aiVerdict = await safeExecute(
        `ai_verdict_${symbol}`,
        () =>
          getAiVerdict({
            shouldInvokeAi,
            snapshot,
            symbol,
            row,
            supabase,
            safetyAi,
            userId,
            signal,
          }),
        { ai: safetyAi, aiQuotaFallback: false },
      );
      const aiVerdictMs = Math.round(performance.now() - aiVerdictStarted);
      const perfAiWarnMs = Number(Deno.env.get("PERF_AI_VERDICT_WARN_MS") ?? "18000");
      const warnMs = Number.isFinite(perfAiWarnMs) && perfAiWarnMs >= 1500 ? perfAiWarnMs : 18_000;
      if (aiVerdictMs > warnMs) {
        console.warn(
          `[PERF] ai_verdict slow ${aiVerdictMs}ms symbol=${symbol} user=${userId} (warn_if>${warnMs}ms)`,
        );
      }
      const ai = aiVerdict.ai;
      const aiQuotaFallback = aiVerdict.aiQuotaFallback;

      const rawExcerptFull =
        typeof ai.raw_ai_response === "string"
          ? ai.raw_ai_response
          : ai.raw_ai_response != null
          ? JSON.stringify(ai.raw_ai_response)
          : "";
      const rawExcerpt = rawExcerptFull.substring(0, 500);
      console.log("[AI]:", {
        symbol,
        provider: ai.ai_provider ?? "unknown",
        raw_len: rawExcerptFull.length,
        raw_model_excerpt: rawExcerpt,
      });

      botDebug("index", "ai_verdict", {
        symbol,
        ai_action: ai.action,
        ai_confidence: ai.ai_confidence,
        ai_trend: ai.trend,
        ai_trend_alignment: ai.trend_alignment,
        ai_provider: ai.ai_provider ?? "unknown",
        ai_provider_path: ai.ai_provider_path ?? "n/a",
        ai_cache_status: ai.ai_cache_status ?? "unknown",
        aiQuotaFallback,
        perf_db_load_open_trade_ms: dbLoadOpenTradeMs,
        perf_ai_verdict_ms: aiVerdictMs,
      });

      const fgRaw = ai.sentiment_vibe?.fear_greed_value;
      const fgNum = Number(fgRaw);
      if (fgRaw != null && Number.isFinite(fgNum)) {
        console.log(
          `📉 [SENTIMENT] ${symbol}: Fear&Greed=${fgNum} label=${ai.sentiment_vibe?.fear_greed_label ?? "n/a"} penalty=${ai.sentiment_vibe?.penalty_applied ? 1 : 0}`,
        );
      }

      const groqVerdictUpper = String(ai.groq_verdict ?? "").toUpperCase();
      if (groqVerdictUpper === "REJECT") {
        ai.action = "HOLD";
        ai.trend_alignment = false;
      }
      const memeSentimentSupport = Number.isFinite(fgNum) ? fgNum > 30 : false;

      const ema200GateBlocks =
        !aggressiveModeEnabled &&
        snapshot.latestPrice < snapshot.ema200 &&
        !preflight.ema200RecoveryOk;
      const orderBookImbalanceExitDisabledUntilMs = (() => {
        const raw = toStringValue((row as any).order_book_imbalance_exit_disabled_until);
        if (!raw) return null;
        const ms = Date.parse(raw);
        return Number.isFinite(ms) ? ms : null;
      })();
      const orderBookImbalanceExitBelow = (() => {
        const n = Number(Deno.env.get("ORDER_BOOK_IMBALANCE_EXIT_BELOW") ?? "");
        return Number.isFinite(n) && n > 0.05 && n < 0.99 ? n : 0.32;
      })();
      const orderBookImbalanceMinHoldMs = (() => {
        const n = Number(Deno.env.get("ORDER_BOOK_IMBALANCE_MIN_HOLD_MS") ?? "");
        return Number.isFinite(n) && n >= 0 && n <= 30 * 60 * 1000 ? n : 90_000;
      })();

      let { decision, reason } = decideHybridMatrix({
        strategySignal,
        hasOpenTrade: !!openTrade,
        strategyExitTriggered: effectiveStrategyExit.shouldExit,
        aggressiveModeEnabled,
        technical,
        technicalScore,
        rsi: snapshot.rsi,
        imbalanceRatio: snapshot.imbalance_ratio,
        marketRegime: snapshot.marketRegime,
        latestPrice: snapshot.latestPrice,
        bbLower: snapshot.bbLower,
        isBreakout: snapshot.latestPrice > snapshot.bbUpper,
        isBelowEma200: ema200GateBlocks,
        ai,
        minAiConfidence,
        minTechnicalScore: minTech,
        symbol,
        volumeSpike,
        memeSentimentSupport,
        orderBookImbalanceExitDisabledUntilMs,
        orderBookImbalanceExitBelow,
        orderBookImbalanceMinHoldMs,
        openTradeOpenedAt: openTrade?.opened_at
          ? String((openTrade as any).opened_at)
          : null,
      });
      const aiConfidence = Number(ai.ai_confidence);
      const groqRejected = groqVerdictUpper === "REJECT";
      const forceBuyTechFloor = Math.max(6, minTech);
      const shouldForceBuy =
        !groqRejected &&
        Number.isFinite(aiConfidence) &&
        aiConfidence >= minAiConfidence &&
        technicalScore >= forceBuyTechFloor &&
        ai.trend !== "bearish";
      const forceBuyReason = shouldForceBuy
        ? `force_buy_override: ai_confidence=${Number.isFinite(aiConfidence) ? aiConfidence : "n/a"}, tech_score=${technicalScore} (ai>=${minAiConfidence} && tech>=${forceBuyTechFloor} && groq!=REJECT && trend!=bearish)`
        : null;
      if (shouldForceBuy) {
        const rangingBlock =
          snapshot.marketRegime === "RANGING" &&
          !passesMeanReversionBuyGate({
            regime: snapshot.marketRegime,
            rsi: snapshot.rsi,
            latestPrice: snapshot.latestPrice,
            bbLower: snapshot.bbLower,
          });
        if (rangingBlock) {
          decision = "HOLD";
          reason =
            "hold_ranging_mean_reversion_required (force buy blocked in chop)";
        } else {
          decision = "BUY";
          reason = forceBuyReason ?? reason;
        }
      }

      if (btcOverbought && symbol !== "BTCUSDT" && decision === "BUY") {
        if (technicalScore > 8) {
          reason = `${reason ?? "buy"}|btc_overbought_strong_buy_override`;
        } else {
          decision = "HOLD";
          reason = "hold_btc_overbought_filter";
        }
      }

      let executionUsdScale: number | undefined;
      if (groqVerdictUpper !== "REJECT") {
        const mtfHalf = tryMtfOnlyHighConfidenceHalfBuy({
          matrix: {
            strategySignal,
            hasOpenTrade: !!openTrade,
            strategyExitTriggered: effectiveStrategyExit.shouldExit,
            aggressiveModeEnabled,
            technical,
            technicalScore,
            rsi: snapshot.rsi,
            imbalanceRatio: snapshot.imbalance_ratio,
            marketRegime: snapshot.marketRegime,
            latestPrice: snapshot.latestPrice,
            bbLower: snapshot.bbLower,
            isBreakout: snapshot.latestPrice > snapshot.bbUpper,
            isBelowEma200: ema200GateBlocks,
            ai,
            minAiConfidence,
            minTechnicalScore: minTech,
            symbol,
            volumeSpike,
            memeSentimentSupport,
            orderBookImbalanceExitDisabledUntilMs,
          },
          snapshot,
          decision,
          reason,
          ai,
        });
        if (mtfHalf.apply) {
          decision = "BUY";
          reason = "mtf_misaligned_high_conf_half_position_override";
          executionUsdScale = mtfHalf.executionUsdScale;
        }
      }

      if (smartNoise.blockBuy && decision === "BUY" && !openTrade) {
        decision = "HOLD";
        reason = smartNoise.blockReason ?? "hold_smart_filter_wide_spread";
        executionUsdScale = undefined;
      }

      const maxOpenTradesRaw = toNumber((row as any).max_open_trades, 0);
      const maxOpenTrades = Number.isFinite(maxOpenTradesRaw) && maxOpenTradesRaw > 0
        ? Math.floor(maxOpenTradesRaw)
        : null;
      if (decision === "BUY" && userId !== "unknown" && maxOpenTrades !== null) {
        const openCountResult = await supabase
          .from("trades")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .ilike("status", "open");
        const openCount = Number(openCountResult.count ?? 0);
        if (openCount >= maxOpenTrades) {
          decision = "HOLD";
          reason = `hold_max_open_trades_limit (${openCount}/${maxOpenTrades})`;
          executionUsdScale = undefined;
        }
      }

      const paperProbe = await resolveDemoPaperProbeBuy({
        supabase,
        userId,
        symbol,
        row,
        hasOpenTrade: Boolean(openTrade),
      });
      if (paperProbe.apply && decision === "HOLD") {
        decision = "BUY";
        reason = paperProbe.reason ?? "demo_inactivity_probe_buy";
        demoProbeBuyFlag = true;
        await safeExecute(
          "demo_paper_probe_activated_log",
          () =>
            supabase.from("logs").insert([{
              user_id: userId,
              symbol,
              level: "info",
              source: "demo-probe-buy",
              message: "demo_paper_probe_activated",
              meta: {
                event: "demo_paper_probe_activated",
                reason: paperProbe.reason,
                paper_only: true,
              },
              created_at: new Date().toISOString(),
            }]),
          undefined,
        );
      }

      const vetoDetailsPayload = formatVetoDetailsPayload({
        veto_reasons: [
          ...preflight.veto_reasons,
          ...(strategyFailDetail ? [strategyFailDetail] : []),
          ...(typeof reason === "string" && reason.startsWith("hold_max_open_trades_limit")
            ? ["FAIL_MAX_TRADES"]
            : []),
          ...(decision === "HOLD" && reason ? [`HOLD:${reason}`] : []),
          ...(demoProbeBuyFlag ? ["DEMO_PAPER_PROBE_BUY_ACTIVE"] : []),
          ...(executionUsdScale != null && executionUsdScale < 1
            ? ["OVERRIDE_MTF_HALF_POSITION"]
            : []),
        ],
        scorecard: preflight.scorecard,
        passedCount: preflight.passedCount,
        totalGates: preflight.totalGates,
        reason,
        decision,
        sentiment_fear_greed: Number.isFinite(fgNum) ? fgNum : null,
        mtf_half_position: Boolean(executionUsdScale != null && executionUsdScale < 1),
        min_tech_score: minTech,
        min_volume_24h_quote: minVolume24hQuote,
      });
      await insertWarRoomAudit({
        supabase,
        user_id: userId !== "unknown" ? userId : null,
        symbol,
        bot_id: toStringValue((row as any).id) ?? null,
        cycle_id: cycleId,
        veto_details: vetoDetailsPayload,
        final_decision: decision,
        technical_score: technicalScore,
        ai_confidence: Number.isFinite(Number(ai.ai_confidence))
          ? Number(ai.ai_confidence)
          : null,
      });

      await persistDebugTrace({
        supabase,
        userId: userId !== "unknown" ? userId : null,
        botId: toStringValue((row as any)?.id) ?? null,
        cycleId,
        symbol,
        decision,
        techScore: technicalScore,
        rsi: snapshot.rsi,
        bbPosition,
        latestPrice: snapshot.latestPrice,
        reason: strategyFailDetail ?? reason ?? null,
        debugNote: forceBuyReason ?? reason,
        perfMetadata: {
          perf_db_load_open_trade_ms: dbLoadOpenTradeMs,
          perf_ai_verdict_ms: aiVerdictMs,
          is_timeout: false,
        },
        ai,
      });
      botDebug("index", "decision_inputs", {
        symbol,
        technical,
        technicalScore,
        strategySignal,
        hasOpenTrade: !!openTrade,
        aggressiveModeEnabled,
        imbalanceRatio: snapshot.imbalance_ratio,
        marketRegime: snapshot.marketRegime,
        adx14: snapshot.adx14,
        atr14: snapshot.atr14,
        aiAction: ai.action,
        aiConfidence: ai.ai_confidence,
        aiTrend: ai.trend,
        aiTrendAlignment: ai.trend_alignment,
        volumeSpike,
        volumeSpikeMultiplier,
        minAiConfidenceAdjusted: minAiConfidence,
        minAiConfidenceSessionBand: sessionAware.sessionBand,
        minAiConfidenceVolumeRatio: sessionAware.volumeRatio,
        minAiConfidenceDelta: sessionAware.confidenceDelta,
      });
      botDebug("index", "decision_computed", { symbol, decision, reason, technicalScore });

      console.log("[EXECUTION]:", {
        symbol,
        userId,
        decision,
        reason: reason ?? "",
        technical,
        process_action_preview: decision,
      });

      await logDecisionTrace({
        supabase,
        row,
        symbol,
        snapshot,
        technicalScore,
        strategySignal,
        technicalSignal: technical,
        ai,
        hasOpenTrade: !!openTrade,
        finalDecision: decision,
        reason,
        minAiConfidence,
      });

      const originalStrategy = strategyEntry.strategy_reason ?? "unknown_strategy";
      let combinedStrategyReason = aiQuotaFallback
        ? `${originalStrategy}|${reason ?? "no_reason"}|ai_quota_fallback`
        : `${originalStrategy}|${reason ?? "no_reason"}`;
      if (executionUsdScale != null && executionUsdScale < 1) {
        combinedStrategyReason =
          `${combinedStrategyReason}|execution_usd_scale=${executionUsdScale}`;
      }

      const result = await processBot({
        supabase,
        row,
        snapshot,
        technical,
        ai,
        decision,
        exitReason: effectiveStrategyExit.exit_reason,
        strategyReason: combinedStrategyReason,
        cycleId,
        executionUsdScale,
        signal,
        demoProbeBuy: demoProbeBuyFlag,
      });

      await logExecutionOutcome({
        supabase,
        row,
        symbol,
        intendedDecision: decision,
        reason,
        resultAction: (result as any)?.action,
        resultDetail: (result as any)?.detail,
        exitReason: (result as any)?.exit_reason,
      });

      await logCycleSummary({
        supabase,
        row,
        symbol,
        technicalScore,
        strategySignal: strategyEntry.signal,
        ai,
        reason,
        finalDecision: decision,
        minAiConfidence,
        marketRegime: snapshot.marketRegime,
      });

      return { tag: "ok" as const, result, symbol, lastPrice: snapshot.latestPrice };
    } catch (error) {
      const detail = formatUnknownError(error);
      if (isEmergencyAbortQuotaError(error)) {
        console.error(`[binance-bot] ${detail} — aborting current cron cycle`);
        return { tag: "emergency" as const, userId, symbol, detail };
      }
      if (detail.startsWith("CRITICAL_PRICE_ZERO:")) {
        return { tag: "critical" as const, error };
      }
      if (detail.startsWith("CRITICAL_INDICATOR_ZERO:")) {
        return { tag: "critical" as const, error };
      }
      botError("index", "bot_cycle_error", { userId, symbol, detail, rawError: error });
      const errorObj = (error && typeof error === "object")
        ? (error as Record<string, unknown>)
        : null;
      await safeExecute("catch_bot_cycle_error_log", async () => {
        const errorLog = await supabase.from("logs").insert([{
          user_id: userId !== "unknown" ? userId : null,
          symbol,
          level: "error",
          source: "bot-cycle-error",
          message: detail.slice(0, 500),
          meta: {
            event: "bot_cycle_error",
            symbol,
            detail,
            error_name: error instanceof Error ? error.name : (typeof errorObj?.name === "string" ? errorObj.name : null),
            error_code: typeof errorObj?.code === "string" ? errorObj.code : null,
            error_details: typeof errorObj?.details === "string" ? errorObj.details : null,
            error_hint: typeof errorObj?.hint === "string" ? errorObj.hint : null,
            stack: error instanceof Error ? error.stack?.slice(0, 1500) : null,
          },
          created_at: new Date().toISOString(),
        }]);
        if (errorLog.error) {
          console.error(`[binance-bot] failed to persist bot-cycle-error log: ${errorLog.error.message}`);
        }
      }, undefined);
      await safeExecute(
        "catch_bot_cycle_summary_log",
        () =>
          logCycleSummary({
            supabase,
            row,
            symbol,
            technicalScore: 0,
            strategySignal: "HOLD",
            ai: {
              ai_confidence: 0,
              trend: "neutral",
              trend_alignment: false,
              action: "HOLD",
              groq_verdict: undefined,
              groq_reason: undefined,
            },
            reason: `runtime_error: ${detail}`,
            finalDecision: "HOLD",
            minAiConfidence,
            marketRegime: "NEUTRAL",
          }),
        undefined,
      );
      return { tag: "err" as const, userId, symbol, detail };
    }
  };

  setActiveTelegramCycleId(cycleId);
  let allSettledElapsedMs = 0;
  try {
    console.log("RUNNING_LOOP:", { n: activeBots.length });
    const allSettledStarted = performance.now();
    const cycleRuns = activeBots.map((row, botIndex) =>
      runSingleBotCycleWithTimeout(
        (signal) => runSingleBotCycle(row, botIndex, signal),
        BOT_CYCLE_TIMEOUT_MS,
        row,
        symbolFilter,
        ({ userId, symbol, timeoutMs, detail }) => {
          return safeExecute(
            "late_completion_after_timeout_log",
            () =>
              supabase.from("logs").insert([{
                user_id: userId !== "unknown" ? userId : null,
                symbol,
                level: "warn",
                source: "bot-timeout-race",
                message: "late_completion_after_timeout",
                meta: {
                  event: "late_completion_after_timeout",
                  timeout_ms: timeoutMs,
                  detail,
                  cycle_id: cycleId,
                },
                created_at: new Date().toISOString(),
              }]),
            undefined,
          );
        },
      )
    );
    const settled = await Promise.allSettled(cycleRuns);
    settled.forEach((entry, botIndex) => {
      const row = activeBots[botIndex] as { user_id?: unknown; symbol?: unknown };
      const userId = toStringValue(row.user_id) ?? "unknown";
      const symbol = normalizeSymbol(row.symbol, symbolFilter);
      if (entry.status === "fulfilled") {
        const o = entry.value;
        if (o.tag === "ok") {
          actions.push(o.result);
          lastAiPriceBySymbol.set(o.symbol, o.lastPrice);
          return;
        }
        if (o.tag === "emergency") {
          cycleEmergencyAbort = true;
          actions.push({
            userId: o.userId,
            symbol: o.symbol,
            decision: "HOLD",
            action: "error",
            detail: o.detail,
          });
          return;
        }
        if (o.tag === "critical") {
          actions.push({
            userId,
            symbol,
            decision: "HOLD",
            action: "error",
            detail: formatUnknownError(o.error),
          });
          return;
        }
        if (o.tag === "timeout") {
          void captureTraceReasonOnly({
            supabase,
            userId: o.userId !== "unknown" ? o.userId : null,
            botId: toStringValue((activeBots[botIndex] as any)?.id) ?? null,
            cycleId,
            symbol: o.symbol,
            decision: "HOLD",
            reason: `TIMEOUT_HOLD:${o.timeoutMs}ms`,
            perfMetadata: { is_timeout: true, timeout_ms: o.timeoutMs },
          });
          actions.push({
            userId: o.userId,
            symbol: o.symbol,
            decision: "HOLD",
            action: "skip",
            detail: `TIMEOUT_HOLD:${o.timeoutMs}ms`,
          });
          return;
        }
        actions.push({
          userId: o.userId,
          symbol: o.symbol,
          decision: "HOLD",
          action: "error",
          detail: o.detail,
        });
        return;
      }
      actions.push({
        userId,
        symbol,
        decision: "HOLD",
        action: "error",
        detail: formatUnknownError(entry.reason),
      });
    });
    allSettledElapsedMs = Math.round(performance.now() - allSettledStarted);
    const loopLatencyWarnMs = (() => {
      const n = Number(Deno.env.get("BOT_LOOP_LATENCY_WARN_MS") ?? "");
      return Number.isFinite(n) && n >= 5000 ? n : 30_000;
    })();
    if (allSettledElapsedMs > loopLatencyWarnMs) {
      console.warn(
        `[binance-bot] Latency Warning: bot loop took ${allSettledElapsedMs}ms (threshold ${loopLatencyWarnMs}ms) cycle_id=${cycleId}`,
      );
      botDebug("index", "latency_warning", {
        elapsedMs: allSettledElapsedMs,
        cycleId,
        thresholdMs: loopLatencyWarnMs,
        phase: "parallel_bots_all_settled",
      });
    }
  } finally {
    setActiveTelegramCycleId(null);
  }

  symbolCache.clear();

  return {
    symbolFilter,
    actions,
    balanceSyncTargets,
    cycleEmergencyAbort,
    cycleId,
    allSettledElapsedMs,
    scanned: activeBots.length,
  };
}

async function runSingleBotCycleWithTimeout(
  task: (
    signal: AbortSignal,
  ) => Promise<
    | { tag: "ok"; result: BotActionResult; symbol: string; lastPrice: number }
    | { tag: "emergency"; userId: string; symbol: string; detail: string }
    | { tag: "critical"; error: unknown }
    | { tag: "err"; userId: string; symbol: string; detail: string }
  >,
  timeoutMs: number,
  row: { user_id?: unknown; symbol?: unknown },
  symbolFallback: string,
  onLateCompletion?: (params: {
    userId: string;
    symbol: string;
    timeoutMs: number;
    detail: string;
  }) => void | Promise<void>,
): Promise<
  | { tag: "ok"; result: BotActionResult; symbol: string; lastPrice: number }
  | { tag: "emergency"; userId: string; symbol: string; detail: string }
  | { tag: "critical"; error: unknown }
  | { tag: "err"; userId: string; symbol: string; detail: string }
  | { tag: "timeout"; userId: string; symbol: string; timeoutMs: number }
> {
  const signal = AbortSignal.timeout(timeoutMs);
  const userId = toStringValue(row.user_id) ?? "unknown";
  const symbol = normalizeSymbol(row.symbol, symbolFallback);
  let timeoutFired = false;
  const taskPromise = task(signal);
  void taskPromise.then(
    () => {
      if (!timeoutFired) return;
      void onLateCompletion?.({
        userId,
        symbol,
        timeoutMs,
        detail: "task_resolved_after_timeout",
      });
    },
    (error) => {
      if (!timeoutFired) return;
      void onLateCompletion?.({
        userId,
        symbol,
        timeoutMs,
        detail: `task_rejected_after_timeout:${formatUnknownError(error)}`,
      });
    },
  );
  const timeoutPromise = new Promise<{ tag: "timeout"; userId: string; symbol: string; timeoutMs: number }>((resolve) => {
    if (signal.aborted) {
      timeoutFired = true;
      resolve({ tag: "timeout", userId, symbol, timeoutMs });
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        timeoutFired = true;
        resolve({ tag: "timeout", userId, symbol, timeoutMs });
      },
      { once: true },
    );
  });
  return await Promise.race([taskPromise, timeoutPromise]);
}

function buildDebugRawAiResponse(params: {
  discriminator: "cache" | "live" | "timeout";
  reason: string | null;
  debugNote?: string;
  latestPrice?: number;
  perfMetadata?: Record<string, unknown>;
  ai: {
    ai_confidence?: number;
    ai_provider?: string;
    ai_cache_status?: string;
    ai_provider_path?: string;
    raw_ai_response?: unknown;
    raw_groq_veto_response?: unknown;
    groq_verdict?: string;
    groq_reason?: string;
  };
}): DebugRawAiResponse {
  const { discriminator, reason, debugNote, latestPrice, perfMetadata, ai } = params;
  const provider = String(ai.ai_provider ?? "unknown").toLowerCase();
  const confidence = Number(ai.ai_confidence);
  const normalizedConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : null;
  const isGroqPrimary = provider === "groq";
  return {
    schema_version: 1,
    discriminator,
    provider: ai.ai_provider ?? "unknown",
    provider_path: ai.ai_provider_path ?? "n/a",
    cache_status: ai.ai_cache_status ?? "unknown",
    confidence: ai.ai_confidence ?? null,
    gemini_conf: normalizedConfidence,
    groq_conf: isGroqPrimary ? normalizedConfidence : null,
    reason: reason ?? debugNote ?? null,
    force_buy_reason: debugNote ?? null,
    raw_price: Number.isFinite(Number(latestPrice)) ? Number(latestPrice) : null,
    formatted_price: Number.isFinite(Number(latestPrice))
      ? toFixedNoExponents(Number(latestPrice))
      : null,
    perf_metadata: perfMetadata ?? null,
    model_response: ai.raw_ai_response ?? null,
    groq_veto: ai.raw_groq_veto_response ?? {
      verdict: ai.groq_verdict ?? null,
      reason: ai.groq_reason ?? null,
    },
  };
}

async function persistDebugTrace(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  botId: string | null;
  cycleId: string;
  symbol: string;
  decision: "BUY" | "SELL" | "HOLD";
  techScore?: number;
  rsi?: number;
  bbPosition?: number;
  latestPrice?: number;
  debugNote?: string;
  reason?: string | null;
  perfMetadata?: Record<string, unknown>;
  ai: {
    ai_confidence?: number;
    ai_provider?: string;
    ai_cache_status?: string;
    ai_provider_path?: string;
    raw_ai_response?: unknown;
    raw_groq_veto_response?: unknown;
    groq_verdict?: string;
    groq_reason?: string;
  };
}) {
  const {
    supabase,
    userId,
    botId,
    cycleId,
    symbol,
    decision,
    techScore,
    rsi,
    bbPosition,
    latestPrice,
    debugNote,
    reason,
    perfMetadata,
    ai,
  } = params;
  const rawPayload: DebugRawAiResponse = buildDebugRawAiResponse({
    discriminator: ai.ai_cache_status === "hit" ? "cache" : "live",
    reason: reason ?? null,
    debugNote,
    latestPrice,
    perfMetadata,
    ai,
  });
  const confidence = Number(ai.ai_confidence);
  const normalizedConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : null;
  const provider = String(ai.ai_provider ?? "").toLowerCase();
  const isGroqPrimary = provider === "groq";
  const payload = {
    user_id: userId,
    bot_id: botId,
    cycle_id: cycleId,
    symbol,
    tech_score: Number.isFinite(Number(techScore)) ? Math.round(Number(techScore)) : null,
    rsi: Number.isFinite(Number(rsi)) ? Number(rsi) : null,
    bb_position: Number.isFinite(Number(bbPosition)) ? Number(bbPosition) : null,
    gemini_conf: normalizedConfidence,
    groq_conf: isGroqPrimary ? normalizedConfidence : null,
    final_decision: decision,
    raw_ai_response: rawPayload,
  };
  const { error } = await supabase
    .from("bot_debug_traces")
    .upsert(payload, { onConflict: "cycle_id,symbol,user_id" });
  if (error) {
    console.error(`[binance-bot] failed to persist debug trace ${symbol}/${cycleId}: ${error.message}`);
  }
}

async function captureTraceReasonOnly(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  botId: string | null;
  cycleId: string;
  symbol: string;
  decision: "BUY" | "SELL" | "HOLD";
  reason: string;
  perfMetadata?: Record<string, unknown>;
}) {
  const { supabase, userId, botId, cycleId, symbol, decision, reason, perfMetadata } = params;
  const { error } = await supabase.from("bot_debug_traces").upsert({
    user_id: userId,
    bot_id: botId,
    cycle_id: cycleId,
    symbol,
    final_decision: decision,
    raw_ai_response: buildDebugRawAiResponse({
      discriminator: "timeout",
      reason,
      perfMetadata,
      ai: { ai_provider: "runtime" },
    }),
  }, { onConflict: "cycle_id,symbol,user_id" });
  if (error) {
    console.error(`[binance-bot] failed to capture reason-only trace for ${symbol}: ${error.message}`);
  }
}

export function mergeBalanceSyncTargets(
  into: Map<string, { isLiveMode: boolean; symbols: Set<string> }>,
  chunk: Map<string, { isLiveMode: boolean; symbols: Set<string> }>,
) {
  for (const [uid, t] of chunk) {
    const prev = into.get(uid) ?? {
      isLiveMode: false,
      symbols: new Set<string>(),
    };
    prev.isLiveMode = prev.isLiveMode || t.isLiveMode;
    for (const s of t.symbols) prev.symbols.add(s);
    into.set(uid, prev);
  }
}

export async function runPostBatchBalanceSync(params: {
  supabase: ReturnType<typeof createClient>;
  balanceSyncTargets: Map<string, { isLiveMode: boolean; symbols: Set<string> }>;
  fallbackSymbol: string;
}) {
  const { supabase, balanceSyncTargets, fallbackSymbol } = params;
  for (const [userId, target] of balanceSyncTargets.entries()) {
    if (!target.isLiveMode) continue;
    const logSymbol = [...target.symbols][0] ?? fallbackSymbol;
    try {
      const liveTotalBalance = await getTotalAccountBalanceUsdt(false);
      if (!Number.isFinite(liveTotalBalance) || liveTotalBalance <= 0) {
        botDebug("index", "balance_sync_skipped_invalid_total", {
          userId,
          symbol: logSymbol,
          liveTotalBalance,
        });
        continue;
      }
      await updateProfileBalance(supabase, userId, liveTotalBalance);
      await supabase.from("account_balances").insert([{
        user_id: userId,
        balance: Number(liveTotalBalance.toFixed(2)),
        timestamp: new Date().toISOString(),
        extra: {
          source: "balance-sync",
          symbols: [...target.symbols],
        },
      }]);
      await supabase.from("logs").insert([{
        user_id: userId,
        symbol: logSymbol,
        level: "info",
        source: "balance-sync",
        message: "profile_balance_synced_from_binance",
        meta: {
          event: "profile_balance_synced_from_binance",
          live_total_balance: Number(liveTotalBalance.toFixed(2)),
        },
        created_at: new Date().toISOString(),
      }]);
    } catch (error) {
      const detail = formatUnknownError(error);
      botError("index", "balance_sync_failed", { userId, symbol: logSymbol, detail });
      await safeExecute(
        "catch_balance_sync_failed_log",
        () =>
          supabase.from("logs").insert([{
            user_id: userId,
            symbol: logSymbol,
            level: "warn",
            source: "balance-sync",
            message: "profile_balance_sync_failed",
            meta: {
              event: "profile_balance_sync_failed",
              detail,
            },
            created_at: new Date().toISOString(),
          }]),
        undefined,
      );
    }
  }
}

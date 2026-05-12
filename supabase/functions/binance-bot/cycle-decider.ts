// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { decideTechnicalSignal } from "./indicators.ts";
import { loadOpenTrade } from "./trade-store.ts";
import { calculateTechnicalScore, checkEntryConditions, checkExitConditions } from "./strategy.ts";
import { evaluateMoneyMachineExits } from "./money-machine-guard.ts";
import { decideHybridMatrix } from "./index-decision.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import { resolveNoTradeFallback } from "./no-trade-fallback.ts";
import { resolveDemoPaperProbeBuy } from "./demo-paper-probe-buy.ts";
import { readForceBuyConfidenceDelta } from "./paper-balance.ts";
import { blockedByBuyReentryGuards } from "./stop-reentry-cooldown.ts";
import { MIN_ADX_FOR_NON_TRENDING_BUY } from "./buy-helpers.ts";
import { resolveSessionAwareMinAiConfidence, resolveVolumeSpikeMultiplier } from "./decision-tuning.ts";
import { getAiVerdict, shouldRunAiCheck } from "./index-ai.ts";
import { resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { formatUnknownError, resolveMinAiConfidenceForRegime, resolveMinTechScore, resolveMinVolume24hQuote, toNumber, toStringValue } from "./utils.ts";
import { collectPreflightVetoChecks, formatVetoDetailsPayload, tryMtfOnlyHighConfidenceHalfBuy } from "./veto-transparency.ts";
import { evaluateSmartNoiseFilter } from "./smart-filter.ts";
import { buildPaperScenarioAiStub } from "./paper-scenario-snapshot.ts";

export async function decideSymbolCycleOutcome(params: {
  row: any;
  supabase: ReturnType<typeof createClient>;
  signal: AbortSignal;
  symbol: string;
  userId: string;
  cycleId: string;
  snapshot: any;
  lastAiPriceBySymbol: Map<string, number>;
  paperScenario?: { name: import("./paper-scenario-snapshot.ts").PaperScenarioName; execute: boolean } | null;
  btcOverbought: boolean;
}) {
  const { row, supabase, signal, symbol, userId, cycleId, snapshot, lastAiPriceBySymbol, paperScenario, btcOverbought } = params;
  let minAiConfidence = resolveMinAiConfidenceForRegime(row as Record<string, unknown>, String(snapshot.marketRegime ?? "NEUTRAL"));
  const strategyEntry = checkEntryConditions(snapshot);
  const dbLoadOpenTradeStarted = performance.now();
  const openTrade = await safeExecute(`db_load_open_trade_${symbol}`, () => loadOpenTrade(supabase, row.user_id, symbol, toStringValue(row.id) ?? undefined), null);
  const dbLoadOpenTradeMs = Math.round(performance.now() - dbLoadOpenTradeStarted);
  if (dbLoadOpenTradeMs > 500) console.warn(`[PERF] db_load_open_trade slow ${dbLoadOpenTradeMs}ms symbol=${symbol} user=${userId}`);
  const strategyExit = checkExitConditions(openTrade, snapshot, toNumber(row.take_profit_pct, NaN));
  const isTestMode = resolveTestMode(row);
  let effectiveStrategyExit = isTestMode && strategyExit.exit_reason === "rsi_overbought" ? { shouldExit: false, exit_reason: "hold" as const } : strategyExit;
  const mm = evaluateMoneyMachineExits({ openTrade, price: snapshot.latestPrice });
  if (mm.forceExit) effectiveStrategyExit = { shouldExit: true, exit_reason: mm.reason === "money_machine_trailing_lock" ? "money_machine_trailing_lock" : mm.reason === "money_machine_hard_stop" ? "money_machine_hard_stop" : "stoploss_hit" };
  if (mm.reason) console.log("[MONEY_MACHINE]", { symbol, ...mm });
  const technical = decideTechnicalSignal(snapshot.rsi, snapshot.emaFast, snapshot.emaSlow, snapshot.latestPrice, row, snapshot.candles5);
  const technicalScore = calculateTechnicalScore(snapshot);
  let aggressiveModeEnabled = Boolean((row as any).is_aggressive_mode);
  let minTech = resolveMinTechScore(row as Record<string, unknown>);
  const minVolume24hQuote = resolveMinVolume24hQuote(row as Record<string, unknown>);
  const isGhostExecution = resolveGhostMode(row);
  const isSandboxMode = isTestMode || isGhostExecution;
  let shouldInvokeAi =
    (aggressiveModeEnabled || technicalScore >= 3) &&
    (aggressiveModeEnabled || shouldRunAiCheck(snapshot, lastAiPriceBySymbol));
  if (mm.skipAi) shouldInvokeAi = false;
  const bbRange = snapshot.bbUpper - snapshot.bbLower;
  const bbPosition = Number.isFinite(bbRange) && bbRange > 0 ? (snapshot.latestPrice - snapshot.bbLower) / bbRange : 0;
  const lastCandle = snapshot.candles5?.at(-1);
  const smartNoise = evaluateSmartNoiseFilter({ snapshot, lastCandleVolume: Number(lastCandle?.volume ?? 0), hasOpenTrade: Boolean(openTrade), isGhostExecution });
  if (smartNoise.sleepAi && !aggressiveModeEnabled && !isSandboxMode) {
    shouldInvokeAi = false;
    console.log("[SMART_FILTER]", { symbol, userId, sleep_ai: 1, volume_1m: smartNoise.volume1m, avg_1m_from_24h: smartNoise.avgVolume1mFrom24h });
  }
  if (!openTrade && strategyEntry.signal === "BUY") shouldInvokeAi = true;
  const volumeSpikeMultiplier = resolveVolumeSpikeMultiplier(symbol);
  const volumeSpike = Boolean(Number(snapshot.avgVolume1m) > 0 && Number(lastCandle?.volume ?? 0) >= Number(snapshot.avgVolume1m) * volumeSpikeMultiplier);
  const sessionAware = resolveSessionAwareMinAiConfidence({ baseMinAiConfidence: minAiConfidence, avgVolume1m: Number(snapshot.avgVolume1m), lastCandleVolume: Number(lastCandle?.volume ?? 0) });
  minAiConfidence = sessionAware.adjustedMinAiConfidence;
  if (aggressiveModeEnabled) {
    const baseMin = toNumber(row.min_ai_confidence, minAiConfidence);
    minAiConfidence = Math.min(minAiConfidence, baseMin);
  }
  const noTradeFallback = await resolveNoTradeFallback({ supabase, userId, symbol, hasOpenTrade: Boolean(openTrade), minAiConfidence, minTechScore: minTech, paperOnly: isSandboxMode && !Boolean((row as any)?.is_live_trading_enabled) });
  if (noTradeFallback.active) {
    minAiConfidence = noTradeFallback.adjustedMinAiConfidence;
    minTech = noTradeFallback.adjustedMinTechScore;
    aggressiveModeEnabled = aggressiveModeEnabled || noTradeFallback.forceAggressiveMode;
    console.log("[NO_TRADE_FALLBACK]", { symbol, userId, days_since_last_buy: noTradeFallback.daysSinceLastBuy, adjusted_min_ai_confidence: minAiConfidence, adjusted_min_tech_score: minTech, force_aggressive: noTradeFallback.forceAggressiveMode ? 1 : 0 });
  }
  const strategySignal = !openTrade && strategyEntry.signal === "SELL" ? "HOLD" : strategyEntry.signal;
  const strategyFailDetail = strategyEntry.signal === "BUY" ? null : `FAIL_STRATEGY:${String(strategyEntry.strategy_fail_detail ?? "NO_BUY")}`;
  const preflight = collectPreflightVetoChecks({ snapshot, technicalScore, aggressiveModeEnabled, strategySignal, minTechnicalScore: minTech, minVolume24hQuote, isSandboxMode, isGhostExecution });
  if (noTradeFallback.active) preflight.veto_reasons.push(`NO_TRADE_FALLBACK_ACTIVE:${String(noTradeFallback.reason ?? "active")}`);
  if (smartNoise.vetoReasons.length) preflight.veto_reasons.push(...smartNoise.vetoReasons);
  const safetyAi = { ai_confidence: 0, trend: "neutral" as const, trend_alignment: false, action: "HOLD" as const, groq_verdict: undefined, groq_reason: undefined };
  const aiVerdictStarted = performance.now();
  const aiVerdict = await safeExecute(`ai_verdict_${symbol}`, () => getAiVerdict({ shouldInvokeAi, snapshot, symbol, row, supabase, safetyAi, userId, signal }), { ai: safetyAi, aiQuotaFallback: false });
  const aiVerdictMs = Math.round(performance.now() - aiVerdictStarted);
  const perfAiWarnMs = Number(Deno.env.get("PERF_AI_VERDICT_WARN_MS") ?? "18000");
  const warnMs = Number.isFinite(perfAiWarnMs) && perfAiWarnMs >= 1500 ? perfAiWarnMs : 18_000;
  if (aiVerdictMs > warnMs) console.warn(`[PERF] ai_verdict slow ${aiVerdictMs}ms symbol=${symbol} user=${userId} (warn_if>${warnMs}ms)`);
  let ai = aiVerdict.ai;
  const aiQuotaFallback = aiVerdict.aiQuotaFallback;
  if (paperScenario?.name) ai = buildPaperScenarioAiStub(minAiConfidence, ai);
  const groqVerdictUpper = String(ai.groq_verdict ?? "").toUpperCase();
  if (groqVerdictUpper === "REJECT") {
    ai.action = "HOLD";
    ai.trend_alignment = false;
  }
  const fgRaw = ai.sentiment_vibe?.fear_greed_value;
  const fgNum = Number(fgRaw);
  const memeSentimentSupport = Number.isFinite(fgNum) ? fgNum > 30 : false;
  const ema200GateBlocks = !aggressiveModeEnabled && snapshot.latestPrice < snapshot.ema200 && !preflight.ema200RecoveryOk;
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
    return Number.isFinite(n) && n >= 0 && n <= 30 * 60 * 1000 ? n : 120_000;
  })();
  const orderBookImbalanceExitWeakStreak = openTrade ? Math.max(0, Math.floor(toNumber((openTrade as any)?.extra?.ob_imbalance_weak_streak, 0))) : 0;
  const matrixTechnical = paperScenario?.name && strategySignal === "BUY" && technical === "HOLD" ? "BUY" : technical;
  let { decision, reason, orderBookImbalanceWeakStreak: nextObWeakStreak } = decideHybridMatrix({
    strategySignal, hasOpenTrade: !!openTrade, strategyExitTriggered: effectiveStrategyExit.shouldExit, aggressiveModeEnabled, technical: matrixTechnical,
    technicalScore, rsi: snapshot.rsi, imbalanceRatio: snapshot.imbalance_ratio, marketRegime: snapshot.marketRegime, latestPrice: snapshot.latestPrice,
    bbLower: snapshot.bbLower, isBreakout: snapshot.latestPrice > snapshot.bbUpper, isBelowEma200: ema200GateBlocks, ai, minAiConfidence,
    minTechnicalScore: minTech, symbol, volumeSpike, memeSentimentSupport, orderBookImbalanceExitDisabledUntilMs, orderBookImbalanceExitBelow,
    orderBookImbalanceMinHoldMs, orderBookImbalanceExitWeakStreak, openTradeOpenedAt: openTrade?.opened_at ? String((openTrade as any).opened_at) : null,
  });
  if (openTrade && typeof nextObWeakStreak === "number" && Number.isFinite(nextObWeakStreak)) {
    const openId = toStringValue((openTrade as any)?.id);
    if (openId) {
      const extra = ((openTrade as any)?.extra as Record<string, unknown> | undefined) ?? {};
      await safeExecute("ob_imbalance_weak_streak_persist", () => supabase.from("trades").update({ extra: { ...extra, ob_imbalance_weak_streak: nextObWeakStreak } }).eq("id", openId).ilike("status", "open"), undefined);
    }
  }
  let buyReentryBlocked = false;
  let buyReentryReason: string | undefined;
  if (!openTrade && userId !== "unknown" && !paperScenario) {
    const guard = await blockedByBuyReentryGuards({ supabase, userId, symbol });
    buyReentryBlocked = guard.blocked;
    buyReentryReason = guard.reason;
  }
  const aiConfidence = Number(ai.ai_confidence);
  const forceBuyTechFloor = Math.max(7, minTech + 2);
  const forceBuyConfidenceFloor = minAiConfidence + readForceBuyConfidenceDelta() + 5;
  const shouldForceBuy = !buyReentryBlocked && strategySignal === "BUY" && groqVerdictUpper !== "REJECT" && ai.action === "BUY" && Number.isFinite(aiConfidence) && aiConfidence >= forceBuyConfidenceFloor && technicalScore >= forceBuyTechFloor && ai.trend !== "bearish";
  const forceBuyReason = shouldForceBuy ? `force_buy_override: ai_confidence=${Number.isFinite(aiConfidence) ? aiConfidence : "n/a"}, tech_score=${technicalScore} (ai>=${forceBuyConfidenceFloor} && tech>=${forceBuyTechFloor} && groq!=REJECT && trend!=bearish && action=BUY)` : null;
  if (shouldForceBuy) {
    const rangingBlock = snapshot.marketRegime === "RANGING" && !passesMeanReversionBuyGate({ regime: snapshot.marketRegime, rsi: snapshot.rsi, latestPrice: snapshot.latestPrice, bbLower: snapshot.bbLower });
    if (rangingBlock) {
      decision = "HOLD";
      reason = "hold_ranging_mean_reversion_required (force buy blocked in chop)";
    } else if (snapshot.marketRegime !== "TRENDING" && Number.isFinite(snapshot.adx14) && snapshot.adx14 < MIN_ADX_FOR_NON_TRENDING_BUY) {
      decision = "HOLD";
      reason = `hold_low_adx_chop (force buy blocked: adx=${snapshot.adx14.toFixed(2)})`;
    } else {
      decision = "BUY";
      reason = forceBuyReason ?? reason;
    }
  }
  if (btcOverbought && symbol !== "BTCUSDT" && decision === "BUY") {
    if (technicalScore > 8) reason = `${reason ?? "buy"}|btc_overbought_strong_buy_override`;
    else {
      decision = "HOLD";
      reason = "hold_btc_overbought_filter";
    }
  }
  let executionUsdScale: number | undefined;
  if (groqVerdictUpper !== "REJECT") {
    const mtfHalf = tryMtfOnlyHighConfidenceHalfBuy({
      matrix: { strategySignal, hasOpenTrade: !!openTrade, strategyExitTriggered: effectiveStrategyExit.shouldExit, aggressiveModeEnabled, technical, technicalScore, rsi: snapshot.rsi, imbalanceRatio: snapshot.imbalance_ratio, marketRegime: snapshot.marketRegime, latestPrice: snapshot.latestPrice, bbLower: snapshot.bbLower, isBreakout: snapshot.latestPrice > snapshot.bbUpper, isBelowEma200: ema200GateBlocks, ai, minAiConfidence, minTechnicalScore: minTech, symbol, volumeSpike, memeSentimentSupport, orderBookImbalanceExitDisabledUntilMs },
      snapshot, decision, reason, ai,
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
  const maxOpenTrades = Number.isFinite(maxOpenTradesRaw) && maxOpenTradesRaw > 0 ? Math.floor(maxOpenTradesRaw) : null;
  if (decision === "BUY" && userId !== "unknown" && maxOpenTrades !== null) {
    const openCountResult = await supabase.from("trades").select("id", { count: "exact", head: true }).eq("user_id", userId).ilike("status", "open");
    const openCount = Number(openCountResult.count ?? 0);
    if (openCount >= maxOpenTrades) {
      decision = "HOLD";
      reason = `hold_max_open_trades_limit (${openCount}/${maxOpenTrades})`;
      executionUsdScale = undefined;
    }
  }
  let demoProbeBuyFlag = false;
  const paperProbe = await resolveDemoPaperProbeBuy({ supabase, userId, symbol, row, hasOpenTrade: Boolean(openTrade) });
  if (paperProbe.apply && decision === "HOLD") {
    decision = "BUY";
    reason = paperProbe.reason ?? "demo_inactivity_probe_buy";
    demoProbeBuyFlag = true;
  }
  const vetoDetailsPayload = formatVetoDetailsPayload({
    veto_reasons: [...preflight.veto_reasons, ...(strategyFailDetail ? [strategyFailDetail] : []), ...(typeof reason === "string" && reason.startsWith("hold_max_open_trades_limit") ? ["FAIL_MAX_TRADES"] : []), ...(decision === "HOLD" && reason ? [`HOLD:${reason}`] : []), ...(demoProbeBuyFlag ? ["DEMO_PAPER_PROBE_BUY_ACTIVE"] : []), ...(executionUsdScale != null && executionUsdScale < 1 ? ["OVERRIDE_MTF_HALF_POSITION"] : [])],
    scorecard: preflight.scorecard, passedCount: preflight.passedCount, totalGates: preflight.totalGates, reason, decision,
    sentiment_fear_greed: Number.isFinite(fgNum) ? fgNum : null, mtf_half_position: Boolean(executionUsdScale != null && executionUsdScale < 1),
    min_tech_score: minTech, min_volume_24h_quote: minVolume24hQuote,
  });
  const originalStrategy = strategyEntry.strategy_reason ?? "unknown_strategy";
  let combinedStrategyReason = aiQuotaFallback ? `${originalStrategy}|${reason ?? "no_reason"}|ai_quota_fallback` : `${originalStrategy}|${reason ?? "no_reason"}`;
  if (executionUsdScale != null && executionUsdScale < 1) combinedStrategyReason = `${combinedStrategyReason}|execution_usd_scale=${executionUsdScale}`;
  if (paperScenario?.name === "force_paper_buy") {
    decision = "BUY";
    reason = "paper_scenario_force_paper_buy";
    if (paperScenario.execute) {
      demoProbeBuyFlag = true;
      executionUsdScale = undefined;
    }
  }
  if (decision === "BUY" && userId !== "unknown" && !openTrade && !paperScenario && buyReentryBlocked) {
    decision = "HOLD";
    reason = buyReentryReason ?? "hold_buy_reentry_guard";
    executionUsdScale = undefined;
    demoProbeBuyFlag = false;
  }
  return {
    ai, aiVerdictMs, bbPosition, combinedStrategyReason, dbLoadOpenTradeMs, decision, demoProbeBuyFlag, effectiveStrategyExit, executionUsdScale,
    forceBuyReason, minAiConfidence, minTech, openTrade, preflight, reason, smartNoise, strategyEntry, strategyFailDetail, strategySignal,
    technical, technicalScore, vetoDetailsPayload, minVolume24hQuote, rawAiExcerpt: (() => {
      try {
        const raw = typeof ai.raw_ai_response === "string" ? ai.raw_ai_response : ai.raw_ai_response != null ? JSON.stringify(ai.raw_ai_response) : "";
        return raw.substring(0, 500);
      } catch (_) {
        return "";
      }
    })(), errorDetail: (error: unknown) => formatUnknownError(error),
  };
}

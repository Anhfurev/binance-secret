// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { decideTechnicalSignal } from "./indicators.ts";
import { loadOpenTrade } from "./trade-store.ts";
import { calculateTechnicalScore, checkEntryConditions, checkExitConditions } from "./strategy.ts";
import {
  isOversoldBounceContext,
  resolveMinTechForOversoldBounce,
} from "./strategy-oversold-bounce.ts";
import { evaluateMoneyMachineExits } from "./money-machine-guard.ts";
import { decideHybridMatrix } from "./index-decision.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import { resolveNoTradeFallback } from "./no-trade-fallback.ts";
import { resolveDemoPaperProbeBuy } from "./demo-paper-probe-buy.ts";
import { readForceBuyConfidenceDelta } from "./paper-balance.ts";
import { blockedByBuyReentryGuards } from "./stop-reentry-cooldown.ts";
import { readMinAdxForNonTrendingBuy } from "./buy-helpers.ts";
import { evaluateChopBuyBlock } from "./chop-entry-guard.ts";
import { resolveSessionAwareMinAiConfidence, resolveVolumeSpikeMultiplier } from "./decision-tuning.ts";
import { getAiVerdict, shouldRunAiCheck } from "./index-ai.ts";
import { resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { safeExecute } from "./safe-execute.ts";
import { formatUnknownError, resolveMinAiConfidenceForRegime, resolveMinTechScore, resolveMinVolume24hQuote, toNumber, toStringValue } from "./utils.ts";
import { collectPreflightVetoChecks, formatVetoDetailsPayload, tryMtfOnlyHighConfidenceHalfBuy } from "./veto-transparency.ts";
import { evaluateSmartNoiseFilter } from "./smart-filter.ts";
import { resolveConfidencePolicy } from "./confidence-policy.ts";
import { resolveTradeRegime } from "./regime-scaling.ts";
import {
  readActiveFrictionSpreadBoost,
  resolveNearMissTag,
} from "./professional-expectancy.ts";
import { resolvePaperLossLesson } from "./paper-loss-lesson.ts";
import { passesDemoPaperProbeQualityGate } from "./demo-paper-probe-buy.ts";
import {
  applySeniorTraderActivityFloors,
  resolveSeniorForceBuyFloors,
  seniorTraderActivityEnabled,
} from "./senior-trader-activity.ts";
import {
  buildPaperScenarioAiStub,
  readPaperScenarioUseLiveAi,
} from "./paper-scenario-snapshot.ts";
import {
  applyLiveStylePracticeFloors,
  paperLiveStylePracticeEnabled,
} from "./live-style-practice.ts";
import { loadProfileDemoBalance } from "./risk-to-stop-sizing.ts";
import {
  buildTradingPolicyAuditSnapshot,
  getRequiredConfidence,
} from "./config/trading-policy.ts";
import { GLOBAL_BOT_CONFIG, resolveStrategyBuyRsiMax } from "./config.ts";
import { allowsEma200HybridBypass } from "./strategy-hybrid-gates.ts";
import {
  aiBiasSupportsSidewaysGrinder,
  appendRegimeTelemetry,
  detectDynamicTradingRegime,
  evaluateTrendingDefensiveGates,
  resolveGrinderTakeProfitPct,
  resolveRegimeGatePolicy,
} from "./dynamic-regime-switcher.ts";

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
  /** Tests / drills: skip LLM and use this verdict (production callers omit). */
  prefetchedAiVerdict?: { ai: import("./types.ts").AiAnalysis; aiQuotaFallback: boolean } | null;
  symbolMatrixIndex?: number;
}) {
  const {
    row,
    supabase,
    signal,
    symbol,
    userId,
    cycleId,
    snapshot,
    lastAiPriceBySymbol,
    paperScenario,
    btcOverbought,
    prefetchedAiVerdict,
  } = params;
  const tradeRegime = resolveTradeRegime(symbol, snapshot.latestPrice, snapshot.atr14);
  let walletBalanceUsd: number | null = null;
  if (userId !== "unknown") {
    try {
      walletBalanceUsd = await loadProfileDemoBalance(supabase, userId);
    } catch {
      walletBalanceUsd = null;
    }
  }
  const tradingPolicyConfidenceGate = getRequiredConfidence(walletBalanceUsd, tradeRegime);
  let minAiConfidence = resolveMinAiConfidenceForRegime(row as Record<string, unknown>, String(snapshot.marketRegime ?? "NEUTRAL"));
  const isTestMode = resolveTestMode(row);
  const isGhostExecution = resolveGhostMode(row);
  const isSandboxMode = isTestMode || isGhostExecution;
  const isPaperTrading = isSandboxMode && !Boolean((row as any)?.is_live_trading_enabled);
  const liveStylePractice = paperLiveStylePracticeEnabled(isPaperTrading);
  const strategyEntry = checkEntryConditions(snapshot, {
    paperExploration: isPaperTrading && !liveStylePractice,
    botSettings: row,
  });
  const dynRegimeDiag = detectDynamicTradingRegime(snapshot);
  const regimeGatePolicy = resolveRegimeGatePolicy(dynRegimeDiag.regime);
  const dbLoadOpenTradeStarted = performance.now();
  const openTrade = await safeExecute(`db_load_open_trade_${symbol}`, () => loadOpenTrade(supabase, row.user_id, symbol, toStringValue(row.id) ?? undefined), null);
  const dbLoadOpenTradeMs = Math.round(performance.now() - dbLoadOpenTradeStarted);
  if (dbLoadOpenTradeMs > 500) console.warn(`[PERF] db_load_open_trade slow ${dbLoadOpenTradeMs}ms symbol=${symbol} user=${userId}`);
  const strategyExit = checkExitConditions(openTrade, snapshot, toNumber(row.take_profit_pct, NaN));
  let effectiveStrategyExit = isTestMode && strategyExit.exit_reason === "rsi_overbought" ? { shouldExit: false, exit_reason: "hold" as const } : strategyExit;
  const mm = evaluateMoneyMachineExits({ openTrade, price: snapshot.latestPrice });
  if (mm.forceExit) effectiveStrategyExit = { shouldExit: true, exit_reason: mm.reason === "money_machine_trailing_lock" ? "money_machine_trailing_lock" : mm.reason === "money_machine_hard_stop" ? "money_machine_hard_stop" : "stoploss_hit" };
  if (mm.reason) console.log("[MONEY_MACHINE]", { symbol, ...mm });
  const technical = decideTechnicalSignal(snapshot.rsi, snapshot.emaFast, snapshot.emaSlow, snapshot.latestPrice, row, snapshot.candles5);
  const technicalScore = calculateTechnicalScore(snapshot);
  let aggressiveModeEnabled = Boolean((row as any).is_aggressive_mode);
  let minTech = resolveMinTechScore(row as Record<string, unknown>);
  const minVolume24hQuote = resolveMinVolume24hQuote(row as Record<string, unknown>);
  let shouldInvokeAi =
    (aggressiveModeEnabled || technicalScore >= 3) &&
    (aggressiveModeEnabled || shouldRunAiCheck(snapshot, lastAiPriceBySymbol));
  if (mm.skipAi) shouldInvokeAi = false;
  const bbRange = snapshot.bbUpper - snapshot.bbLower;
  const bbPosition = Number.isFinite(bbRange) && bbRange > 0 ? (snapshot.latestPrice - snapshot.bbLower) / bbRange : 0;
  const lastCandle = snapshot.candles5?.at(-1);
  const smartNoise = evaluateSmartNoiseFilter({
    snapshot,
    lastCandleVolume: Number(lastCandle?.volume ?? 0),
    hasOpenTrade: Boolean(openTrade),
    isGhostExecution,
    paperRelaxed: isPaperTrading && !liveStylePractice,
  });
  if (smartNoise.sleepAi && !aggressiveModeEnabled && !isSandboxMode) {
    shouldInvokeAi = false;
    console.log("[SMART_FILTER]", { symbol, userId, sleep_ai: 1, volume_1m: smartNoise.volume1m, avg_1m_from_24h: smartNoise.avgVolume1mFrom24h });
  }
  if (!openTrade && strategyEntry.signal === "BUY") shouldInvokeAi = true;
  const paperLiveAiDrill = Boolean(paperScenario?.name && readPaperScenarioUseLiveAi());
  if (paperLiveAiDrill) shouldInvokeAi = true;
  const volumeSpikeMultiplier = resolveVolumeSpikeMultiplier(symbol);
  const volumeSpike = Boolean(Number(snapshot.avgVolume1m) > 0 && Number(lastCandle?.volume ?? 0) >= Number(snapshot.avgVolume1m) * volumeSpikeMultiplier);
  const sessionAware = resolveSessionAwareMinAiConfidence({ baseMinAiConfidence: minAiConfidence, avgVolume1m: Number(snapshot.avgVolume1m), lastCandleVolume: Number(lastCandle?.volume ?? 0) });
  minAiConfidence = sessionAware.adjustedMinAiConfidence;
  if (aggressiveModeEnabled) {
    const baseMin = toNumber(row.min_ai_confidence, minAiConfidence);
    minAiConfidence = Math.min(minAiConfidence, baseMin);
  }
  const noTradeFallback = await resolveNoTradeFallback({
    supabase,
    userId,
    symbol,
    hasOpenTrade: Boolean(openTrade),
    minAiConfidence,
    minTechScore: minTech,
    paperOnly: isPaperTrading && !liveStylePractice,
  });
  if (noTradeFallback.active) {
    minAiConfidence = noTradeFallback.adjustedMinAiConfidence;
    minTech = noTradeFallback.adjustedMinTechScore;
    if (!liveStylePractice) {
      aggressiveModeEnabled = aggressiveModeEnabled || noTradeFallback.forceAggressiveMode;
    }
    console.log("[NO_TRADE_FALLBACK]", { symbol, userId, days_since_last_buy: noTradeFallback.daysSinceLastBuy, adjusted_min_ai_confidence: minAiConfidence, adjusted_min_tech_score: minTech, force_aggressive: noTradeFallback.forceAggressiveMode ? 1 : 0, live_style_practice: liveStylePractice ? 1 : 0 });
  }
  const seniorActivityEnabled = seniorTraderActivityEnabled(
    row as { is_aggressive_mode?: boolean },
    isPaperTrading,
  ) && !liveStylePractice;
  const seniorFloors = applySeniorTraderActivityFloors({
    minAiConfidence,
    minTechScore: minTech,
    enabled: seniorActivityEnabled,
  });
  minAiConfidence = seniorFloors.minAiConfidence;
  minTech = seniorFloors.minTechScore;
  const practicedFloors = applyLiveStylePracticeFloors({
    minAiConfidence,
    minTechScore: minTech,
    enabled: liveStylePractice,
  });
  minAiConfidence = practicedFloors.minAiConfidence;
  minTech = practicedFloors.minTechScore;
  const strategyReasonEarly = strategyEntry.strategy_reason ?? null;
  if (isOversoldBounceContext(snapshot, strategyReasonEarly)) {
    const relaxedTech = resolveMinTechForOversoldBounce(minTech, snapshot, strategyReasonEarly);
    if (relaxedTech < minTech) {
      console.log("[OVERSOLD_BOUNCE]", {
        symbol,
        rsi: snapshot.rsi,
        min_tech_before: minTech,
        min_tech_after: relaxedTech,
        strategy_reason: strategyReasonEarly,
      });
      minTech = relaxedTech;
    }
  }
  minAiConfidence = Math.max(
    minAiConfidence,
    tradingPolicyConfidenceGate.minAiConfidence,
    GLOBAL_BOT_CONFIG.AI_BUY_CONVICTION_THRESHOLD,
    regimeGatePolicy.minAiConfidenceFloor,
  );
  let paperLossLesson: Awaited<ReturnType<typeof resolvePaperLossLesson>> | null = null;
  if (isPaperTrading && !openTrade && userId !== "unknown") {
    paperLossLesson = await resolvePaperLossLesson({
      supabase,
      userId,
      symbol,
      regime: String(snapshot.marketRegime ?? "NEUTRAL"),
      rsi: Number(snapshot.rsi),
      latestPrice: Number(snapshot.latestPrice),
      bbLower: Number(snapshot.bbLower),
    });
    if (paperLossLesson.confidenceBump > 0) {
      minAiConfidence = Math.min(95, minAiConfidence + paperLossLesson.confidenceBump);
    }
    if (paperLossLesson.reason) {
      console.log("[PAPER_LOSS_LESSON]", { symbol, userId, ...paperLossLesson });
    }
  }
  let strategySignal = !openTrade && strategyEntry.signal === "SELL" ? "HOLD" : strategyEntry.signal;
  const strategyFailDetail = strategyEntry.signal === "BUY" ? null : `FAIL_STRATEGY:${String(strategyEntry.strategy_fail_detail ?? "NO_BUY")}`;
  const preflight = collectPreflightVetoChecks({
    snapshot,
    technicalScore,
    aggressiveModeEnabled,
    strategySignal,
    minTechnicalScore: minTech,
    minVolume24hQuote,
    isSandboxMode,
    isGhostExecution,
    strategyReason: strategyEntry.strategy_reason,
    buyRsiMax: resolveStrategyBuyRsiMax(row),
    gatePolicy: regimeGatePolicy,
  });
  if (noTradeFallback.active) preflight.veto_reasons.push(`NO_TRADE_FALLBACK_ACTIVE:${String(noTradeFallback.reason ?? "active")}`);
  if (smartNoise.vetoReasons.length) preflight.veto_reasons.push(...smartNoise.vetoReasons);
  const safetyAi = { ai_confidence: 0, trend: "neutral" as const, trend_alignment: false, action: "HOLD" as const, groq_verdict: undefined, groq_reason: undefined };
  let aiVerdictMs = 0;
  let aiVerdictErrorDetail: string | null = null;
  let aiVerdict: { ai: import("./types.ts").AiAnalysis; aiQuotaFallback: boolean };
  if (prefetchedAiVerdict) {
    aiVerdict = prefetchedAiVerdict;
  } else {
    const aiVerdictStarted = performance.now();
    aiVerdict = await safeExecute(`ai_verdict_${symbol}`, async () => {
      try {
        return await getAiVerdict({
          shouldInvokeAi,
          snapshot,
          symbol,
          row,
          supabase,
          safetyAi,
          userId,
          signal,
          paperScenarioLiveAi: paperLiveAiDrill,
          symbolMatrixIndex: params.symbolMatrixIndex,
        });
      } catch (e) {
        aiVerdictErrorDetail = formatUnknownError(e);
        throw e;
      }
    }, { ai: safetyAi, aiQuotaFallback: false });
    aiVerdictMs = Math.round(performance.now() - aiVerdictStarted);
    const perfAiWarnMs = Number(Deno.env.get("PERF_AI_VERDICT_WARN_MS") ?? "18000");
    const warnMs = Number.isFinite(perfAiWarnMs) && perfAiWarnMs >= 1500 ? perfAiWarnMs : 18_000;
    if (aiVerdictMs > warnMs) console.warn(`[PERF] ai_verdict slow ${aiVerdictMs}ms symbol=${symbol} user=${userId} (warn_if>${warnMs}ms)`);
  }
  let ai = aiVerdict.ai;
  const aiQuotaFallback = aiVerdict.aiQuotaFallback;
  if (paperScenario?.name && !readPaperScenarioUseLiveAi()) ai = buildPaperScenarioAiStub(minAiConfidence, ai);
  const groqVerdictUpper = String(ai.groq_verdict ?? "").toUpperCase();
  if (groqVerdictUpper === "REJECT") {
    ai.action = "HOLD";
    ai.trend_alignment = false;
  }
  const fgRaw = ai.sentiment_vibe?.fear_greed_value;
  const fgNum = Number(fgRaw);
  const memeSentimentSupport = Number.isFinite(fgNum) ? fgNum > 30 : false;
  const aiConfidence = Number(ai.ai_confidence);
  if (
    regimeGatePolicy.regime === "REGIME_SIDEWAYS" &&
    strategySignal !== "BUY" &&
    !openTrade &&
    aiBiasSupportsSidewaysGrinder(ai) &&
    Number.isFinite(aiConfidence) &&
    aiConfidence >= regimeGatePolicy.minAiConfidenceFloor &&
    snapshot.rsi < regimeGatePolicy.rsiEntryMax
  ) {
    strategySignal = "BUY";
    strategyEntry.strategy_reason = "strategy_sideways_ai_grinder_entry";
    strategyEntry.signal = "BUY";
  }
  const hybridEma200Bypass = allowsEma200HybridBypass({
    snapshot,
    strategySignal,
    strategyReason: strategyEntry.strategy_reason,
    technicalScore,
    aiConfidence,
    gatePolicy: regimeGatePolicy,
  });
  const ema200GateBlocks = !aggressiveModeEnabled &&
    snapshot.latestPrice < snapshot.ema200 &&
    !preflight.ema200RecoveryOk &&
    !hybridEma200Bypass;
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
  const strategyBuyRsiThreshold = resolveStrategyBuyRsiMax(row);
  let { decision, reason, orderBookImbalanceWeakStreak: nextObWeakStreak } = decideHybridMatrix({
    strategySignal, hasOpenTrade: !!openTrade, strategyExitTriggered: effectiveStrategyExit.shouldExit, aggressiveModeEnabled, technical: matrixTechnical,
    technicalScore, rsi: snapshot.rsi, imbalanceRatio: snapshot.imbalance_ratio, marketRegime: snapshot.marketRegime, latestPrice: snapshot.latestPrice,
    bbLower: snapshot.bbLower, isBreakout: snapshot.latestPrice > snapshot.bbUpper, isBelowEma200: ema200GateBlocks, ai, minAiConfidence,
    minTechnicalScore: minTech, symbol, volumeSpike, memeSentimentSupport, orderBookImbalanceExitDisabledUntilMs, orderBookImbalanceExitBelow,
    orderBookImbalanceMinHoldMs, orderBookImbalanceExitWeakStreak, openTradeOpenedAt: openTrade?.opened_at ? String((openTrade as any).opened_at) : null,
    noTradeScoutActive: noTradeFallback.active,
    paperExploration: isPaperTrading && !liveStylePractice,
    strategyBuyRsiThreshold,
    strategyReason: strategyEntry.strategy_reason ?? null,
    oversoldBounceActive: isOversoldBounceContext(snapshot, strategyEntry.strategy_reason),
    gatePolicy: regimeGatePolicy,
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
    const guard = await blockedByBuyReentryGuards({ supabase, userId, symbol, paperOnly: isPaperTrading });
    buyReentryBlocked = guard.blocked;
    buyReentryReason = guard.reason;
  }
  const seniorForceBuy = resolveSeniorForceBuyFloors({
    minAiConfidence,
    minTechScore: minTech,
    enabled: seniorActivityEnabled,
    forceBuyConfidenceDelta: readForceBuyConfidenceDelta(),
  });
  const forceBuyTechFloor = seniorForceBuy.techFloor;
  const forceBuyConfidenceFloor = seniorForceBuy.confidenceFloor;
  const shouldForceBuy = !buyReentryBlocked && strategySignal === "BUY" && groqVerdictUpper !== "REJECT" && ai.action === "BUY" && Number.isFinite(aiConfidence) && aiConfidence >= forceBuyConfidenceFloor && technicalScore >= forceBuyTechFloor && ai.trend !== "bearish";
  const forceBuyReason = shouldForceBuy ? `force_buy_override: ai_confidence=${Number.isFinite(aiConfidence) ? aiConfidence : "n/a"}, tech_score=${technicalScore} (ai>=${forceBuyConfidenceFloor} && tech>=${forceBuyTechFloor} && groq!=REJECT && trend!=bearish && action=BUY)` : null;
  if (shouldForceBuy) {
    const rangingBlock = snapshot.marketRegime === "RANGING" && !passesMeanReversionBuyGate({ regime: snapshot.marketRegime, rsi: snapshot.rsi, latestPrice: snapshot.latestPrice, bbLower: snapshot.bbLower });
    if (rangingBlock) {
      decision = "HOLD";
      reason = "hold_ranging_mean_reversion_required (force buy blocked in chop)";
    } else if (snapshot.marketRegime !== "TRENDING" && Number.isFinite(snapshot.adx14) && snapshot.adx14 < readMinAdxForNonTrendingBuy(liveStylePractice)) {
      decision = "HOLD";
      reason = `hold_low_adx_chop (force buy blocked: adx=${snapshot.adx14.toFixed(2)})`;
    } else {
      decision = "BUY";
      reason = forceBuyReason ?? reason;
    }
  }
  if (paperLossLesson?.blockBuy && decision === "BUY") {
    decision = "HOLD";
    reason = paperLossLesson.reason ?? "hold_paper_loss_lesson";
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
  if (smartNoise.blockBuy && decision === "BUY" && !openTrade && !isSandboxMode) {
    decision = "HOLD";
    reason = smartNoise.blockReason ?? "hold_smart_filter_wide_spread";
    executionUsdScale = undefined;
  }
  if (decision === "BUY" && regimeGatePolicy.regime === "REGIME_TRENDING") {
    const trendDef = evaluateTrendingDefensiveGates({
      policy: regimeGatePolicy,
      snapshot,
      strategySignal,
    });
    if (!trendDef.ok) {
      decision = "HOLD";
      reason = `hold_trending_defensive:${trendDef.failCodes.join(",")}`;
      executionUsdScale = undefined;
    }
  }
  const maxOpenTradesRaw = toNumber((row as any).max_open_trades, 0);
  const maxOpenTrades = Number.isFinite(maxOpenTradesRaw) && maxOpenTradesRaw > 0 ? Math.floor(maxOpenTradesRaw) : null;
  if (decision === "BUY" && userId !== "unknown" && maxOpenTrades !== null) {
    const openCountResult = await supabase
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .ilike("status", "open")
      .or("extra->>is_ghost.is.null,extra->>is_ghost.eq.false");
    const openCount = Number(openCountResult.count ?? 0);
    if (openCount >= maxOpenTrades) {
      decision = "HOLD";
      reason = `hold_max_open_trades_limit (${openCount}/${maxOpenTrades})`;
      executionUsdScale = undefined;
    }
  }
  let demoProbeBuyFlag = false;
  const paperProbe = await resolveDemoPaperProbeBuy({ supabase, userId, symbol, row, hasOpenTrade: Boolean(openTrade) });
  const probeQualityOk = passesDemoPaperProbeQualityGate({
    strategySignal,
    technicalScore,
    minTech,
    minAiConfidence,
    ai,
    groqRejected: groqVerdictUpper === "REJECT",
  });
  if (paperProbe.apply && decision === "HOLD" && probeQualityOk) {
    decision = "BUY";
    reason = paperProbe.reason ?? "demo_inactivity_probe_buy";
    demoProbeBuyFlag = true;
  } else if (paperProbe.apply && decision === "HOLD" && !probeQualityOk) {
    reason = `${reason ?? "hold"}|demo_probe_blocked_quality_gate`;
  }
  if (decision === "BUY" && !openTrade && isPaperTrading && liveStylePractice && !demoProbeBuyFlag) {
    const chopBlock = evaluateChopBuyBlock({
      snapshot,
      paperLiveStyle: liveStylePractice,
      enabled: true,
    });
    if (chopBlock.block) {
      decision = "HOLD";
      reason = chopBlock.reason ?? "hold_chop_entry_guard";
      executionUsdScale = undefined;
    }
  }
  const confidencePolicy = resolveConfidencePolicy(row as Record<string, unknown>, {
    marketRegime: String(snapshot.marketRegime ?? "NEUTRAL"),
    tradeRegime,
  });
  const blockedTradingPolicyRules: string[] = [];
  const reasonStr = typeof reason === "string" ? reason : "";
  if (decision === "HOLD") {
    if (
      reasonStr.includes("hold_ai") ||
      reasonStr.includes("min_ai") ||
      reasonStr.includes("confidence")
    ) {
      blockedTradingPolicyRules.push("unified.getRequiredConfidence.minAiConfidence");
    }
    if (preflight.veto_reasons.includes("FAIL_TECH_SCORE")) {
      blockedTradingPolicyRules.push("paperLiveStylePractice.minTechScoreFloor");
    }
    if (reasonStr.includes("grind") || reasonStr.includes("weighted")) {
      blockedTradingPolicyRules.push("confidencePolicy.execution_weighted_floor");
    }
  }
  const tradingPolicyAudit = buildTradingPolicyAuditSnapshot({
    tradeRegime,
    walletBalanceUsd,
    unifiedMinAi: tradingPolicyConfidenceGate.minAiConfidence,
    policy_rule_refs: tradingPolicyConfidenceGate.policy_rule_refs,
  });
  const vetoDetailsPayload = formatVetoDetailsPayload({
    veto_reasons: [...preflight.veto_reasons, ...(strategyFailDetail ? [strategyFailDetail] : []), ...(typeof reason === "string" && reason.startsWith("hold_max_open_trades_limit") ? ["FAIL_MAX_TRADES"] : []), ...(decision === "HOLD" && reason ? [`HOLD:${reason}`] : []), ...(demoProbeBuyFlag ? ["DEMO_PAPER_PROBE_BUY_ACTIVE"] : []), ...(executionUsdScale != null && executionUsdScale < 1 ? ["OVERRIDE_MTF_HALF_POSITION"] : [])],
    scorecard: preflight.scorecard, passedCount: preflight.passedCount, totalGates: preflight.totalGates, reason, decision,
    sentiment_fear_greed: Number.isFinite(fgNum) ? fgNum : null, mtf_half_position: Boolean(executionUsdScale != null && executionUsdScale < 1),
    min_tech_score: minTech, min_volume_24h_quote: minVolume24hQuote,
    confidence_policy: confidencePolicy,
    grinder_floor: confidencePolicy.grinder_weighted_floor,
    friction_spread_boost_bps: readActiveFrictionSpreadBoost(),
    near_miss: decision === "HOLD"
      ? resolveNearMissTag({
        aiConfidence,
        grinderFloor: confidencePolicy.execution_weighted_floor,
        policy: confidencePolicy,
      })
      : null,
    trading_policy_audit: tradingPolicyAudit,
    blocked_trading_policy_rules: blockedTradingPolicyRules,
  });
  const grinderTakeProfitPct = resolveGrinderTakeProfitPct({
    policy: regimeGatePolicy,
    strategyReason: strategyEntry.strategy_reason,
    decision,
  });
  const originalStrategy = strategyEntry.strategy_reason ?? "unknown_strategy";
  let combinedStrategyReason = appendRegimeTelemetry(
    aiQuotaFallback ? `${originalStrategy}|${reason ?? "no_reason"}|ai_quota_fallback` : `${originalStrategy}|${reason ?? "no_reason"}`,
    dynRegimeDiag,
  );
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
    ai,
    aiQuotaFallback,
    aiVerdictErrorDetail,
    aiVerdictMs,
    bbPosition,
    combinedStrategyReason,
    dbLoadOpenTradeMs,
    decision,
    demoProbeBuyFlag,
    effectiveStrategyExit,
    executionUsdScale,
    forceBuyReason,
    minAiConfidence,
    minTech,
    openTrade,
    preflight,
    reason,
    smartNoise,
    strategyEntry,
    strategyFailDetail,
    strategySignal,
    technical,
    technicalScore,
    vetoDetailsPayload,
    minVolume24hQuote,
    grinderTakeProfitPct,
    dynRegimeDiag,
    regimeGatePolicy,
    rawAiExcerpt: (() => {
      try {
        const raw = typeof ai.raw_ai_response === "string" ? ai.raw_ai_response : ai.raw_ai_response != null ? JSON.stringify(ai.raw_ai_response) : "";
        return raw.substring(0, 500);
      } catch (_) {
        return "";
      }
    })(), errorDetail: (error: unknown) => formatUnknownError(error),
  };
}

// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  ATR_STOP_TRAIL_MULTIPLIER,
  MIN_TRADE_USD,
  TRADING_AMOUNT_USD,
  VOL_BURST_MAX_ATR_BONUS,
} from "./constants.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { calculateDynamicPositionSize, getWinLossRatio } from "./execution.ts";
import type { AiAnalysis, BotSettingsRow, MarketRegime, SignalDecision } from "./types.ts";
import {
  clamp,
  coinIdFromSymbol,
  formatUnknownError,
  resolveMinAiConfidenceForRegime,
  toNumber,
  toStringValue,
} from "./utils.ts";
import { createOrder, getUsdtBalance } from "./binance.ts";
import {
  computeEmaLastFromCloses,
  fetchCandlesOHLCV,
} from "./exchange-client.ts";
import { insertTrade, resolveTradeSizeUsd, updateProfileBalance } from "./trade-store.ts";
import {
  escapeHtml,
  formatTelegramPrice,
  formatUsdAlertAmount,
  fromUsdCents,
  resolveExchangeSkipped,
  resolveGhostMode,
  resolveTestMode,
  toUsdCents,
} from "./bot-shared.ts";
import { persistRunTelemetry } from "./bot-telemetry.ts";
import { botDebug, botError, botWarn, sentryWarRoomVetoBreadcrumb } from "./bot-debug.ts";
import {
  computeWeightedConfidenceForRegime,
  estimatePreSentimentWeightedForRegime,
  getResolvedScoreWeightsPack,
} from "./ai-scoring.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import {
  evaluateWarRoomConsensus,
  type WarRoomConsensus,
} from "./war-room.ts";
import { safeExecute } from "./safe-execute.ts";

const AI_REASONING_JSON_MAX = 50_000;

/** Insert into `public.logs`; failures surface in Edge Function logs (Dashboard → Functions → binance-bot → Logs). */
async function safeInsertLog(
  supabase: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
  context: string,
) {
  const { error } = await supabase.from("logs").insert([row]);
  if (error) {
    console.error(
      `[binance-bot] public.logs insert failed (${context}): ${error.message} code=${error.code ?? ""}`,
    );
  }
}

/** Ghost/paper execution audit row for BUY decisions (no exchange side effect). */
async function logMockTrade(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  tradeUsd: number;
  price: number;
  qty: number;
  strategyNotes: string;
}) {
  const { supabase, userId, symbol, tradeUsd, price, qty, strategyNotes } = params;
  await safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "info",
      source: "mock-execution",
      message: "GHOST_BUY",
      meta: {
        event: "ghost_buy",
        usd_size: Number(tradeUsd.toFixed(4)),
        price: Number(price.toFixed(8)),
        qty: Number(qty.toFixed(8)),
        strategy: strategyNotes,
      },
      created_at: new Date().toISOString(),
    },
    "ghost_buy_mock_execution",
  );
}

/** `computeEmaLastFromCloses(closes, 200)` needs `closes.length >= 201`. */
const MIN_1H_BARS_FOR_LIVE_MTF = 201;
/** When 1h is bearish (close < EMA200 on 1h series), weighted score cannot exceed this before the 78% gate. */
const ONE_H_BEARISH_MAX_CONFIDENCE = 40;

/** Stop / initial trail distance below entry: `atrStopMult×ATR` when ATR valid, else `entry × pctFraction`. */
function volatilityAdjustedDistanceDown(
  entry: number,
  atr14: number,
  pctFallbackFraction: number,
  /** Effective trail mult (base `ATR_STOP_TRAIL_MULTIPLIER` × vol-burst widen). */
  atrStopMult = ATR_STOP_TRAIL_MULTIPLIER,
): number {
  const minRel = 0.0005;
  const m = Number.isFinite(atrStopMult) && atrStopMult > 0 ? atrStopMult : ATR_STOP_TRAIL_MULTIPLIER;
  if (Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(entry) && entry > 0) {
    return Math.max(m * atr14, entry * minRel);
  }
  const f = clamp(pctFallbackFraction, 0.0005, 0.5);
  return Math.max(entry * f, entry * minRel);
}

async function resolveBuyFlowMtfContext(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  isTestMode: boolean;
  snapshotPrice: number;
  snapshotEma200?: number;
  signal?: AbortSignal;
}): Promise<{
  bearish1hCap: boolean;
  mtf: Record<string, unknown>;
  /** Live only: true when 1h OHLCV is missing/short/invalid — caller must skip BUY (no MTF = no trade). */
  mtfDataRejected: boolean;
}> {
  const { supabase, userId, symbol, isTestMode, snapshotPrice, snapshotEma200, signal } = params;
  if (isTestMode) {
    const em = toNumber(snapshotEma200, NaN);
    const bearish =
      Number.isFinite(em) &&
      Number.isFinite(snapshotPrice) &&
      snapshotPrice < em;
    return {
      bearish1hCap: bearish,
      mtfDataRejected: false,
      mtf: {
        source: "paper_snapshot_only",
        execution_tf: "5m (not fetched in paper)",
        trend_tf: "snapshot_ema200",
        last_price: snapshotPrice,
        ema200: Number.isFinite(em) ? em : null,
        bearish_1h_price_below_ema200: bearish,
      },
    };
  }
  if (signal?.aborted) {
    throw new Error(`CYCLE_ABORTED:${symbol}`);
  }
  try {
    const [c5, c1h] = await Promise.all([
      fetchCandlesOHLCV(symbol, "5m", 150, signal),
      fetchCandlesOHLCV(symbol, "1h", 220, signal),
    ]);
    const closes5 = c5.map((x) => x.close);
    const closes1h = c1h.map((x) => x.close);
    const ema200 = computeEmaLastFromCloses(closes1h, 200);
    const last1h = closes1h.length ? closes1h[closes1h.length - 1] : NaN;
    const barsOk = c1h.length >= MIN_1H_BARS_FOR_LIVE_MTF;
    const emaOk =
      ema200 != null &&
      Number.isFinite(Number(ema200));
    const lastOk = Number.isFinite(last1h);
    const mtfDataRejected = !barsOk || !emaOk || !lastOk;
    const bearish =
      !mtfDataRejected &&
      ema200 != null &&
      Number.isFinite(last1h) &&
      Number(last1h) < Number(ema200);
    return {
      bearish1hCap: bearish,
      mtfDataRejected,
      mtf: {
        source: mtfDataRejected ? "binance_ohlcv_insufficient" : "binance_ohlcv",
        execution_tf: "5m",
        trend_tf: "1h",
        bars_5m: c5.length,
        bars_1h: c1h.length,
        min_1h_bars_required: MIN_1H_BARS_FOR_LIVE_MTF,
        last_5m_close: closes5.length ? closes5[closes5.length - 1] : null,
        last_1h_close: lastOk ? last1h : null,
        ema200_on_1h_closes: emaOk ? ema200 : null,
        bearish_1h_price_below_ema200: bearish,
        ...(mtfDataRejected
          ? {
            reject_reason: !barsOk
              ? "1h_series_too_short_or_empty"
              : !emaOk
              ? "ema200_not_computable"
              : "last_1h_close_invalid",
          }
          : {}),
      },
    };
  } catch (e) {
    await safeExecute(
      "catch_mtf_ohlcv_fetch_failed_log",
      () =>
        supabase.from("logs").insert([{
          user_id: userId,
          symbol,
          level: "warn",
          source: "buy-flow",
          message: "mtf_ohlcv_fetch_failed",
          meta: {
            event: "mtf_ohlcv_fetch_failed",
            detail: e instanceof Error ? e.message : String(e),
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
    botError("buyFlow", "mtf_ohlcv_fetch_failed", {
      symbol,
      detail: e instanceof Error ? e.message : String(e),
    });
    const emSnap = toNumber(snapshotEma200, NaN);
    return {
      bearish1hCap: false,
      mtfDataRejected: true,
      mtf: {
        source: "ohlcv_fetch_failed",
        error: e instanceof Error ? e.message : String(e),
        last_price: snapshotPrice,
        ema200_snapshot: Number.isFinite(emSnap) ? emSnap : null,
        bearish_1h_price_below_ema200: false,
        reject_reason: "fetch_threw_no_fallback_trade",
      },
    };
  }
}

function truncateJsonExcerpt(x: unknown, max: number): string | null {
  if (x == null) return null;
  const s = typeof x === "string" ? x : JSON.stringify(x);
  if (!s) return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** JSON for `trades.ai_reasoning` (frontend + audit): pro_tip, scorecard, effective vs raw weighted, MTF. */
function buildAiReasoningJson(
  ai: AiAnalysis,
  effectiveConfidence: number,
  audit: {
    raw_weighted: number;
    /** Weighted score before sentiment ×0.7 (30% haircut); null if no penalty. */
    weighted_pre_sentiment_vibe: number | null;
    bearish_1h_cap: boolean;
    mtf: Record<string, unknown>;
    market_regime: MarketRegime;
    adx14: number;
    score_weight_profile: "trend_following" | "mean_reversion";
    /** Weights actually used for `raw_weighted_confidence` (learned + defaults). */
    resolved_weights: Record<string, number>;
    war_room?: WarRoomConsensus;
  },
): string {
  const weightsUsed = { ...audit.resolved_weights };
  const payload: Record<string, unknown> = {
    pro_tip: ai.pro_tip ?? "",
    scorecard: {
      trend_score: ai.trend_score ?? 0,
      momentum_score: ai.momentum_score ?? 0,
      volume_score: ai.volume_score ?? 0,
      order_book_score: ai.order_book_score ?? 0,
    },
    /** Weighted (regime) score after sentiment haircut, before 1h bearish cap. */
    raw_weighted_confidence: audit.raw_weighted,
    /** Weighted score if sentiment had **not** applied scorecard × penalty_factor. */
    weighted_pre_sentiment_vibe: audit.weighted_pre_sentiment_vibe,
    sentiment_penalty_applied: Boolean(ai.sentiment_vibe?.penalty_applied),
    sentiment_penalty_factor: ai.sentiment_vibe?.penalty_factor ?? null,
    effective_confidence: effectiveConfidence,
    one_h_bearish_cap_applied: audit.bearish_1h_cap,
    one_h_bearish_cap_max: ONE_H_BEARISH_MAX_CONFIDENCE,
    mtf_context: audit.mtf,
    market_regime: audit.market_regime,
    adx14: audit.adx14,
    score_weight_profile: audit.score_weight_profile,
    weights: weightsUsed,
    meta: {
      ai_provider: ai.ai_provider ?? null,
      ai_provider_path: ai.ai_provider_path ?? null,
      trend: ai.trend,
      action: ai.action,
      groq_verdict: ai.groq_verdict ?? null,
      sentiment_vibe: ai.sentiment_vibe ?? null,
    },
    groq_reason: ai.groq_reason ?? null,
    raw_model_excerpt: truncateJsonExcerpt(ai.raw_ai_response, 2500),
  };
  if (audit.war_room) {
    const wr = audit.war_room;
    payload.war_room = {
      agent_votes: wr.agent_votes,
      final_governance: wr.final_governance,
      governance_floor: wr.governance_floor,
      base_floor: wr.base_floor,
      quorum_passed: wr.quorum_passed,
      technician_score: wr.technician_score,
      effective_chart_confidence: wr.effective_chart_confidence,
      effective_confidence_after_governance: wr.effective_confidence_after_governance,
    };
  }
  let s = JSON.stringify(payload);
  if (s.length > AI_REASONING_JSON_MAX) {
    payload.raw_model_excerpt = null;
    s = JSON.stringify(payload);
    if (s.length > AI_REASONING_JSON_MAX) {
      s = s.slice(0, AI_REASONING_JSON_MAX);
    }
  }
  return s;
}

/** Ghost / audit: persist War Room outcome without opening a trade row. */
async function logWarRoomGhostSnapshot(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  warRoom: WarRoomConsensus;
  rawWeighted: number;
  effectiveChart: number;
  regime: MarketRegime;
  detail: string;
}) {
  const { supabase, userId, symbol, warRoom, rawWeighted, effectiveChart, regime, detail } =
    params;
  await safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "info",
      source: "war-room-ghost",
      message: "war_room_snapshot",
      meta: {
        event: "war_room_ghost_snapshot",
        detail,
        regime,
        raw_weighted_confidence: rawWeighted,
        effective_chart_confidence: effectiveChart,
        war_room: {
          agent_votes: warRoom.agent_votes,
          final_governance: warRoom.final_governance,
          governance_floor: warRoom.governance_floor,
          base_floor: warRoom.base_floor,
          quorum_passed: warRoom.quorum_passed,
        },
      },
      created_at: new Date().toISOString(),
    },
    "war_room_ghost_snapshot",
  );
}

async function logBuyFlowFailure(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const { supabase, userId, symbol, message, meta } = params;
  await safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "error",
      source: "buy-flow-error",
      message,
      meta: {
        event: "buy_flow_error",
        ...(meta ?? {}),
      },
      created_at: new Date().toISOString(),
    },
    "buy_flow_error",
  );
}

export async function executeBuyFlow(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  technical: SignalDecision;
  strategyNotes: string;
  snapshotPrice: number;
  /** Snapshot EMA200 (e.g. from decision payload) — used in paper mode and OHLCV fallback for 1h bearish cap. */
  snapshotEma200?: number;
  /** ADX/BB regime from 1h snapshot — RANGING uses MR weights + dip gate. */
  marketRegime: MarketRegime;
  snapshotRsi: number;
  snapshotBbLower: number;
  adx14: number;
  /** ATR(14) on 1m — SL and initial trail use `ATR_STOP_TRAIL_MULTIPLIER × atr14` when > 0. */
  atr14: number;
  currentBalance: number;
  resolvedStartingBalance: number;
  shouldInitializeStartingBalance: boolean;
  maxDrawdownLimitPct: number;
  trailingStopPct: number;
  cycleId: string;
  /** From `computeVolatilityBurstGuard` — widens ATR SL/trail when squeeze precursor fires. */
  volBurstWidenMult?: number;
  volBurstMeta?: Record<string, unknown>;
  /** Order book bid/ask imbalance (War Room whale agent). */
  snapshotImbalanceRatio?: number;
  /** 24h quote volume from ticker when available. */
  snapshotVolume24hQuote?: number | null;
  /** Multiply final env-based `tradeUsd` when below 1 (e.g. MTF half-position override). */
  executionUsdScale?: number;
  /** Paper/demo-only probe BUY — skips War Room quorum + ranging dip gate (never with live trading). */
  demoProbeBuy?: boolean;
  signal?: AbortSignal;
}) {
  const {
    supabase, row, userId, symbol, ai, technical, strategyNotes, snapshotPrice,
    snapshotEma200,
    marketRegime,
    snapshotRsi,
    snapshotBbLower,
    adx14,
    atr14,
    currentBalance, resolvedStartingBalance, shouldInitializeStartingBalance, maxDrawdownLimitPct,
    trailingStopPct,
    cycleId,
    volBurstWidenMult = 1,
    volBurstMeta,
    snapshotImbalanceRatio,
    snapshotVolume24hQuote,
    executionUsdScale,
    demoProbeBuy = false,
    signal,
  } = params;

  const demoProbePaper =
    Boolean(demoProbeBuy) && !Boolean((row as any)?.is_live_trading_enabled);
  if (signal?.aborted) {
    return { action: "skip" as const, detail: "cycle_aborted" };
  }

  const regime: MarketRegime = marketRegime ?? "NEUTRAL";
  const scoreWeightProfile: "trend_following" | "mean_reversion" =
    regime === "RANGING" ? "mean_reversion" : "trend_following";
  const scorePack = getResolvedScoreWeightsPack(row as Record<string, unknown>);
  const resolvedWeights =
    regime === "RANGING" ? scorePack.mr : scorePack.tf;
  const rawWeighted = computeWeightedConfidenceForRegime(
    ai,
    regime,
    resolvedWeights,
  );

  const drawdownPct = resolvedStartingBalance > 0
    ? ((resolvedStartingBalance - currentBalance) / resolvedStartingBalance) * 100
    : 0;
  const ghostMode = resolveGhostMode(row);
  const hasDrawdownBreach = Number.isFinite(drawdownPct) && drawdownPct > maxDrawdownLimitPct;
  if (hasDrawdownBreach) {
    botWarn("buyFlow", "drawdown_breach_block", {
      userId,
      symbol,
      drawdownPct,
      maxDrawdownLimitPct,
      ghostMode,
    });
    if (ghostMode) {
      return {
        action: "skip" as const,
        detail:
          `Ghost BUY skipped: drawdown ${drawdownPct.toFixed(2)}% would breach live safety (autopilot not changed).`,
      };
    }
    const nowIso = new Date().toISOString();
    await sendTelegramAlert(
      `CRITICAL: DRAWDOWN BREACH\nSymbol: ${escapeHtml(symbol)}\nCurrent Balance: ${currentBalance.toFixed(2)} USDT\nStarting Balance: ${resolvedStartingBalance.toFixed(2)} USDT\nDrawdown: ${drawdownPct.toFixed(2)}%\nLimit: ${maxDrawdownLimitPct.toFixed(2)}%\nAUTOPILOT DISABLED FOR SAFETY`,
    );
    await supabase.from("bot_settings").update({ is_autopilot_enabled: false, updated_at: nowIso } as any).eq("user_id", userId);
    await safeInsertLog(
      supabase,
      {
        user_id: userId,
        symbol,
        level: "warn",
        source: "safety",
        message: "drawdown_autopilot_disabled",
        meta: {
          event: "drawdown_autopilot_disabled",
          balance_at_breach: Number(currentBalance.toFixed(2)),
          drawdown_pct: Number(drawdownPct.toFixed(2)),
          limit: Number(maxDrawdownLimitPct.toFixed(2)),
        },
        created_at: nowIso,
      },
      "drawdown_autopilot_disabled",
    );
    return { action: "skip" as const, detail: `BUY blocked by drawdown breach (${drawdownPct.toFixed(2)}% > ${maxDrawdownLimitPct.toFixed(2)}%)` };
  }

  if (
    !demoProbePaper &&
    regime === "RANGING" &&
    !passesMeanReversionBuyGate({
      regime,
      rsi: snapshotRsi,
      latestPrice: snapshotPrice,
      bbLower: snapshotBbLower,
    })
  ) {
    botWarn("buyFlow", "ranging_mean_reversion_gate", {
      userId,
      symbol,
      regime,
      adx14,
      rsi: snapshotRsi,
      latestPrice: snapshotPrice,
      bbLower: snapshotBbLower,
      rawWeighted,
    });
    return {
      action: "skip" as const,
      detail:
        "BUY blocked: RANGING regime (ADX<20 + tight BB) — require mean-reversion (RSI<40, RSI<32, or price at lower BB); avoids trend-chasing in chop.",
    };
  }

  const isTestMode = resolveTestMode(row);
  const exchangeSkipped = resolveExchangeSkipped(row);
  const { bearish1hCap, mtf, mtfDataRejected } = await resolveBuyFlowMtfContext({
    supabase,
    userId,
    symbol,
    isTestMode: isTestMode && !ghostMode,
    snapshotPrice,
    snapshotEma200,
    signal,
  });
  const strictMtfBlock = (!isTestMode || ghostMode) && mtfDataRejected;
  if (strictMtfBlock) {
    botWarn("buyFlow", "mtf_no_data_block", {
      userId,
      symbol,
      mtf,
      ghostMode,
    });
    return {
      action: "skip" as const,
      detail:
        "BUY blocked: live MTF guard requires valid 1h OHLCV (≥201 bars) and EMA200; fetch failed or data insufficient (No Data = No Trade).",
    };
  }
  const effectiveConfidence = bearish1hCap
    ? Math.min(rawWeighted, ONE_H_BEARISH_MAX_CONFIDENCE)
    : rawWeighted;
  if (bearish1hCap && rawWeighted > effectiveConfidence) {
    botWarn("buyFlow", "one_h_bearish_confidence_cap", {
      userId,
      symbol,
      rawWeighted,
      cappedTo: effectiveConfidence,
      capMax: ONE_H_BEARISH_MAX_CONFIDENCE,
    });
  }

  const tradeAmount = 20;
  const envTradingAmount = Number(Deno.env.get("TRADING_AMOUNT") ?? TRADING_AMOUNT_USD ?? 0);
  const finalTradeUsd = Math.max(20, envTradingAmount || 20);
  let tradeUsd = Math.min(currentBalance, Math.max(tradeAmount, finalTradeUsd));
  const scaleUsd = Number(executionUsdScale ?? 1);
  if (Number.isFinite(scaleUsd) && scaleUsd > 0 && scaleUsd < 1) {
    tradeUsd = Math.max(MIN_TRADE_USD, tradeUsd * scaleUsd);
  }
  botDebug("buyFlow", "position_sizing", {
    userId,
    symbol,
    tradeAmount,
    finalTradeUsd,
    selectedTradeUsd: tradeUsd,
    aiConfidence: ai.ai_confidence,
    marketRegime: regime,
    adx14,
    scoreWeightProfile,
    weightedConfidenceRaw: rawWeighted,
    weightedConfidenceEffective: effectiveConfidence,
    bearish1hCap,
    tradingAmountEnvUsd: envTradingAmount,
    execution_usd_scale: scaleUsd < 1 ? scaleUsd : 1,
  });
  if (tradeUsd < MIN_TRADE_USD) {
    botWarn("buyFlow", "min_trade_block", { userId, symbol, tradeUsd, minTrade: MIN_TRADE_USD });
    await logBuyFlowFailure({
      supabase,
      userId,
      symbol,
      message: "min_trade_block",
      meta: {
        reason: "trade_usd_below_min_trade_usd",
        trade_usd: Number(tradeUsd.toFixed(8)),
        min_trade_usd: MIN_TRADE_USD,
        ai_confidence: Number(ai.ai_confidence),
      },
    });
    return { action: "skip" as const, detail: `Balance too low for BUY (${currentBalance.toFixed(2)})` };
  }

  const imbRaw = snapshotImbalanceRatio;
  const imb = Number(imbRaw);
  const warRoomMarket = {
    imbalance_ratio: Number.isFinite(imb) ? imb : 1,
    volume_24h_quote:
      snapshotVolume24hQuote === null || snapshotVolume24hQuote === undefined
        ? null
        : Number(snapshotVolume24hQuote),
  };

  const baseRegimeFloor = resolveMinAiConfidenceForRegime(
    row as Record<string, unknown>,
    String(regime),
  );

  const warRoom = evaluateWarRoomConsensus({
    rawWeightedConfidence: rawWeighted,
    effectiveChartConfidence: effectiveConfidence,
    ai,
    marketContext: warRoomMarket,
    baseRegimeFloor,
  });

  if (demoProbePaper) {
    botDebug("buyFlow", "demo_paper_probe_gates_relaxed", {
      userId,
      symbol,
      news_veto: warRoom.news_veto,
      quorum_passed: warRoom.quorum_passed,
      regime,
    });
  }

  if (warRoom.news_veto && !demoProbePaper) {
    sentryWarRoomVetoBreadcrumb({
      final_governance: warRoom.final_governance,
      news_vibe: ai.sentiment_vibe,
      technician_score: warRoom.technician_score,
      userId,
      symbol,
    });
    botWarn("buyFlow", "war_room_news_veto", {
      userId,
      symbol,
      agent_votes: warRoom.agent_votes,
      governance_floor: warRoom.governance_floor,
    });
    if (ghostMode) {
      await logWarRoomGhostSnapshot({
        supabase,
        userId,
        symbol,
        warRoom,
        rawWeighted,
        effectiveChart: effectiveConfidence,
        regime,
        detail: "news_veto",
      });
    } else {
      await safeInsertLog(
        supabase,
        {
          user_id: userId,
          symbol,
          level: "info",
          source: "war-room",
          message: "war_room_news_veto",
          meta: {
            event: "war_room_news_veto",
            agent_votes: warRoom.agent_votes,
            raw_weighted: rawWeighted,
            effective_chart: effectiveConfidence,
          },
          created_at: new Date().toISOString(),
        },
        "war_room_news_veto",
      );
    }
    return {
      action: "skip" as const,
      detail:
        `BUY blocked: War Room news veto (sentiment fear/hack with penalty — chart raw ${rawWeighted.toFixed(2)}%, effective chart ${effectiveConfidence.toFixed(2)}%).`,
    };
  }

  if (!warRoom.quorum_passed && !demoProbePaper) {
    const goldenRatioBounceCandidate =
      bearish1hCap &&
      rawWeighted >= warRoom.governance_floor;
    // Sentry-eligible breadcrumb: the trade we *might* have taken pre-cap.
    // Carries the technician/effective/floor tuple so post-mortem can decide
    // whether the 1h cap or whale floor lift was the true blocker.
    botDebug("buyFlow", "war_room_quorum_failed", {
      userId,
      symbol,
      effective_confidence: Number(effectiveConfidence.toFixed(2)),
      raw_weighted: Number(rawWeighted.toFixed(2)),
      governance_floor: warRoom.governance_floor,
      base_floor: warRoom.base_floor,
      bearish_1h_cap: bearish1hCap,
      golden_ratio_bounce_candidate: goldenRatioBounceCandidate,
      whale_warning: warRoom.whale_warning,
      agent_votes: warRoom.agent_votes,
      final_governance: warRoom.final_governance,
      market_regime: regime,
    });
    botWarn("buyFlow", "war_room_quorum_gate", {
      userId,
      symbol,
      effectiveConfidence,
      rawWeighted,
      governance_floor: warRoom.governance_floor,
      base_floor: warRoom.base_floor,
      bearish1hCap,
      golden_ratio_bounce_candidate: goldenRatioBounceCandidate,
      agent_votes: warRoom.agent_votes,
      final_governance: warRoom.final_governance,
      mtf,
    });
    if (ghostMode) {
      await logWarRoomGhostSnapshot({
        supabase,
        userId,
        symbol,
        warRoom,
        rawWeighted,
        effectiveChart: effectiveConfidence,
        regime,
        detail: warRoom.final_governance,
      });
    } else {
      await safeInsertLog(
        supabase,
        {
          user_id: userId,
          symbol,
          level: "info",
          source: "war-room",
          message: "war_room_quorum_gate",
          meta: {
            event: "war_room_quorum_blocked",
            agent_votes: warRoom.agent_votes,
            final_governance: warRoom.final_governance,
            raw_weighted: rawWeighted,
            effective_chart: effectiveConfidence,
            governance_floor: warRoom.governance_floor,
            base_floor: warRoom.base_floor,
            bearish_1h_cap: bearish1hCap,
            golden_ratio_bounce_candidate: goldenRatioBounceCandidate,
            market_regime: regime,
          },
          created_at: new Date().toISOString(),
        },
        "war_room_quorum_live",
      );
    }
    return {
      action: "skip" as const,
      detail:
        `BUY blocked: War Room quorum — technician raw ${rawWeighted.toFixed(2)}% and chart ${effectiveConfidence.toFixed(2)}% must meet or exceed governance floor ${warRoom.governance_floor}% (${warRoom.final_governance}; whale=${warRoom.agent_votes.whale})${bearish1hCap ? "; 1h bearish cap on chart score" : ""}.`,
    };
  }

  /** Single execution truth after governance (demo probe can synthesize a floor when paper-only). */
  let executionConfidence = warRoom.effective_confidence_after_governance;
  if (demoProbePaper) {
    executionConfidence = Math.max(
      Number(executionConfidence) || 0,
      rawWeighted,
      effectiveConfidence,
      55,
    );
  }
  if (!Number.isFinite(executionConfidence) || executionConfidence <= 0) {
    if (demoProbePaper) {
      executionConfidence = Math.max(55, rawWeighted, effectiveConfidence, 1);
    } else {
      botWarn("buyFlow", "war_room_execution_confidence_zero_guard", {
        userId,
        symbol,
        executionConfidence,
        news_veto: warRoom.news_veto,
        quorum_passed: warRoom.quorum_passed,
        effective_chart: warRoom.effective_chart_confidence,
      });
      return {
        action: "skip" as const,
        detail:
          "BUY blocked: post–War Room guard — effective_confidence_after_governance is not finite/positive (would not call exchange).",
      };
    }
  }

  botDebug("buyFlow", "war_room_gate_passed", {
    userId,
    symbol,
    executionConfidence,
    final_governance: warRoom.final_governance,
    news_veto: warRoom.news_veto,
    quorum_passed: warRoom.quorum_passed,
    governance_floor: warRoom.governance_floor,
    technician_score: warRoom.technician_score,
    effective_chart_confidence: warRoom.effective_chart_confidence,
  });

  // Live-mode pre-flight: talk to the REAL exchange BEFORE we try to place an
  // order. Aborting here avoids a -2010 / -2019 "insufficient balance" rejection
  // from Binance and, importantly, prevents a duplicate trade row if we retry.
  // Test mode keeps the existing check but with a mocked balance.
  const isLiveMode = !exchangeSkipped;
  // Ghost/test must not hit Binance for balance (hard wall: no signed REST on this path).
  const usdtBalance = await getUsdtBalance(isTestMode || ghostMode);
  if (usdtBalance < tradeUsd) {
    const shortBy = Number((tradeUsd - usdtBalance).toFixed(2));
    botWarn("buyFlow", "insufficient_usdt_block", {
      userId,
      symbol,
      usdtBalance,
      tradeUsd,
      shortBy,
      isLiveMode,
    });
    if (isLiveMode) {
      await logBuyFlowFailure({
        supabase,
        userId,
        symbol,
        message: "wallet_insufficient_funds",
        meta: {
          reason: "insufficient_balance_preflight",
          usdt_balance: Number(usdtBalance.toFixed(2)),
          trade_usd: Number(tradeUsd.toFixed(2)),
          short_by: shortBy,
          ai_confidence: Number(ai.ai_confidence),
          action: "abort_before_exchange",
        },
      });
    }
    return {
      action: "skip" as const,
      detail: isLiveMode
        ? `LIVE ABORT: wallet_insufficient_funds — need ${tradeUsd.toFixed(2)} USDT, have ${usdtBalance.toFixed(2)} (short ${shortBy.toFixed(2)})`
        : `Insufficient USDT balance (${usdtBalance.toFixed(2)} < ${tradeUsd.toFixed(2)})`,
    };
  }

  botDebug("buyFlow", "preflight_balance_ok", {
    userId,
    symbol,
    tradeUsd: Number(tradeUsd.toFixed(4)),
    usdtBalance: Number(usdtBalance.toFixed(4)),
    ghostMode,
    isLiveMode,
    executionConfidence,
  });

  // NOTE: keep full float precision for micro-priced assets (e.g. PEPEUSDT).
  // Using .toFixed(2) here rounds prices < $0.01 down to 0 and then the DB
  // "price NOT NULL" constraint rejects the trade.
  // Single sizing pass: same snapshotPrice as DB entry / SL / TP.
  const qty = Number((tradeUsd / snapshotPrice).toFixed(8));
  const stopLossPct = clamp(toNumber(row.stop_loss_pct, 2), 0.1, 50);
  const takeProfitPct = clamp(toNumber(row.take_profit_pct, 4), 0.1, 100);
  const entryPriceFull = Number(snapshotPrice.toFixed(8));
  const stopLossPctFraction = stopLossPct / 100;
  // Defense-in-depth: producer caps at 1 + VOL_BURST_MAX_ATR_BONUS, but a
  // corrupted snapshot or non-canonical caller could push this arbitrarily high
  // and put the SL at near-zero (effectively no stop). Hard-cap on consumer.
  const VB_MAX = 1 + VOL_BURST_MAX_ATR_BONUS;
  const vbRaw = Number(volBurstWidenMult);
  const vb = Number.isFinite(vbRaw) && vbRaw >= 1
    ? Math.min(vbRaw, VB_MAX)
    : 1;
  if (Number.isFinite(vbRaw) && vbRaw > VB_MAX) {
    botWarn("buyFlow", "vol_burst_widen_mult_clamped", {
      userId,
      symbol,
      vol_burst_widen_mult_raw: vbRaw,
      vol_burst_widen_mult_max: VB_MAX,
      vol_burst_widen_mult_used: vb,
    });
  }
  // Sentry-eligible breadcrumb: burst guard returned 1.0 (no widen) due to
  // dirty data or insufficient bars rather than a clean "no squeeze" signal.
  // Without this we'd never know we *expected* protection and didn't get it.
  const vbReason =
    volBurstMeta && typeof (volBurstMeta as { reason?: unknown }).reason === "string"
      ? String((volBurstMeta as { reason: string }).reason)
      : null;
  const vbDirtyReasons = new Set([
    "kline_gap_or_nonmonotonic_time",
    "invalid_closes",
    "invalid_volume",
    "insufficient_candles",
    "insufficient_bb_widths",
  ]);
  if (vbReason && vbDirtyReasons.has(vbReason)) {
    botDebug("buyFlow", "vol_burst_guard_dirty_data", {
      userId,
      symbol,
      reason: vbReason,
      meta: volBurstMeta ?? null,
      atr14,
      market_regime: regime,
    });
  }
  const atrTrailEffective = Number((ATR_STOP_TRAIL_MULTIPLIER * vb).toFixed(6));
  if (vb > 1.002) {
    botDebug("buyFlow", "vol_burst_guard_active", {
      userId,
      symbol,
      vol_burst_widen_mult: vb,
      atr_trail_effective: atrTrailEffective,
    });
  }
  const slDistance = volatilityAdjustedDistanceDown(
    entryPriceFull,
    atr14,
    stopLossPctFraction,
    atrTrailEffective,
  );
  const stopLossRaw = entryPriceFull - slDistance;
  let stopLossPrice = Number(
    Math.min(entryPriceFull * (1 - 1e-8), Math.max(stopLossRaw, entryPriceFull * 1e-8)).toFixed(8),
  );
  if (!(stopLossPrice < entryPriceFull)) {
    stopLossPrice = Number((entryPriceFull * (1 - stopLossPctFraction)).toFixed(8));
  }
  const takeProfitPrice = Number((snapshotPrice * (1 + takeProfitPct / 100)).toFixed(8));
  const trailDistance = volatilityAdjustedDistanceDown(
    entryPriceFull,
    atr14,
    trailingStopPct,
    atrTrailEffective,
  );
  let initialTrailingStopPrice = Number(
    Math.min(entryPriceFull * (1 - 1e-8), Math.max(entryPriceFull - trailDistance, entryPriceFull * 1e-8)).toFixed(8),
  );
  if (!(initialTrailingStopPrice < entryPriceFull)) {
    initialTrailingStopPrice = Number((entryPriceFull * (1 - trailingStopPct)).toFixed(8));
  }
  const openedAt = new Date().toISOString();
  const botId = toStringValue((row as any).id);
  botDebug("buyFlow", "execution_mode", {
    userId,
    symbol,
    isTestMode,
    ghostMode,
    exchangeSkipped,
    liveExecutionEnabled: !exchangeSkipped,
    aiConfidence: toNumber(ai.ai_confidence, 0),
  });

  if (isTestMode && !ghostMode) {
    await safeInsertLog(
      supabase,
      {
        user_id: userId,
        symbol,
        level: "info",
        source: "dry-run",
        message: "buy_intent_dry_run",
        meta: {
          event: "buy_intent_dry_run",
          symbol,
          price: Number(snapshotPrice.toFixed(8)),
          ai_confidence: Number(ai.ai_confidence),
          weighted_confidence_raw: rawWeighted,
          weighted_confidence_effective: effectiveConfidence,
          bearish_1h_cap: bearish1hCap,
          mtf,
          scorecard: {
            trend: ai.trend_score,
            momentum: ai.momentum_score,
            volume: ai.volume_score,
            order_book: ai.order_book_score,
          },
          qty,
          usd_size: Number(tradeUsd.toFixed(2)),
        },
        created_at: openedAt,
      },
      "buy_intent_dry_run",
    );
  }

  let reservationId: string | null = null;
  if (!ghostMode) {
    const { data: reserved, error: reserveError } = await supabase.rpc("reserve_buy_capital", {
      p_user_id: userId,
      p_symbol: symbol,
      p_requested_usd: tradeUsd,
      p_min_dust_usd: 2.0,
    });
    if (reserveError) {
      botWarn("buyFlow", "reserve_buy_capital_rpc_error", {
        userId,
        symbol,
        detail: reserveError.message,
      });
      return {
        action: "skip" as const,
        detail: `reserve_buy_capital RPC failed: ${reserveError.message}`,
      };
    }

    reservationId =
      typeof reserved === "string" && reserved.length > 0
        ? reserved
        : (reserved && typeof (reserved as { reservation_id?: string }).reservation_id === "string"
          ? (reserved as { reservation_id: string }).reservation_id
          : null);

    if (!reservationId) {
      // Sentry-eligible breadcrumb: trade was preflight-affordable
      // (`usdtBalance >= tradeUsd` already passed) but reserve_buy_capital
      // refused. After the ghost-exclusion fix, a null here means a *real*
      // phantom block — open notionals + active reservations + dust ate the
      // headroom.
      botDebug("buyFlow", "capital_reservation_phantom_block", {
        userId,
        symbol,
        trade_usd: Number(tradeUsd.toFixed(2)),
        usdt_balance_preflight: Number(usdtBalance.toFixed(2)),
        current_balance: Number(currentBalance.toFixed(2)),
        cycle_id: cycleId,
        bot_id: botId || null,
        ghost_mode: ghostMode,
      });
      botWarn("buyFlow", "insufficient_balance_reserved", {
        userId,
        symbol,
        tradeUsd: Number(tradeUsd.toFixed(8)),
      });
      console.log(
        `[buyFlow] Insufficient balance (reserved) user=${userId} symbol=${symbol} tradeUsd=${tradeUsd.toFixed(2)}`,
      );
      await safeInsertLog(
        supabase,
        {
          user_id: userId,
          symbol,
          level: "warn",
          source: "buy-flow",
          message: "Insufficient balance (reserved)",
          meta: {
            event: "reserve_buy_capital_null",
            trade_usd: Number(tradeUsd.toFixed(8)),
            cycle_id: cycleId,
          },
          created_at: new Date().toISOString(),
        },
        "reserve_buy_capital_null",
      );
      await sendTelegramAlert(
        `⏸️ <b>TRADE SKIPPED — Capital constrained</b>\n` +
          `<b>Summary:</b> <code>reserve_buy_capital</code> returned no reservation (headroom covers open notionals + active reservations + min dust).\n` +
          `<b>Symbol:</b> ${escapeHtml(symbol)}\n` +
          `<b>Requested (USDT):</b> ${tradeUsd.toFixed(2)}\n` +
          `<b>Balance snapshot (USDT):</b> ${Number(currentBalance.toFixed(2))}\n` +
          `<b>Effective confidence:</b> ${effectiveConfidence.toFixed(2)}%` +
          (bearish1hCap && rawWeighted > effectiveConfidence
            ? ` (capped from ${rawWeighted.toFixed(2)}% — 1h below EMA200)\n`
            : "\n") +
          `<b>Model aggregate:</b> ${Number(ai.ai_confidence).toFixed(2)}%\n` +
          `<b>Next step:</b> reduce concurrent bots, wait for reservations to clear, or fund wallet.`,
      );
      return {
        action: "skip" as const,
        detail: "Insufficient balance (reserved)",
      };
    }
  }

  try {
    botDebug("buyFlow", "pre_create_order", {
      userId,
      symbol,
      tradeUsd: Number(tradeUsd.toFixed(4)),
      ghostMode,
      exchangeSkipped,
      executionConfidence,
      cycleId,
      botId: botId || null,
    });
    // Hard wall: ghost execution must never call CCXT with isTestMode: false.
    if (ghostMode && !exchangeSkipped) {
      botError("buyFlow", "ghost_live_create_order_invariant_broken", {
        userId,
        symbol,
        ghostMode,
        exchangeSkipped,
      });
      throw new Error(
        "Invariant: ghostMode requires resolveExchangeSkipped — refusing createOrder to protect live funds",
      );
    }
    const createOrderTestShortCircuit = ghostMode ? true : exchangeSkipped;
    console.log(`[ORDER] Attempting to buy ${symbol} with $${tradeUsd}...`);
    const buyOrder = await createOrder({
      supabase,
      userId,
      botId: botId ?? undefined,
      cycleId,
      symbol,
      side: "buy",
      amount: qty,
      referencePrice: snapshotPrice,
      marketRegime: regime,
      maxSlippagePct: 0.2,
      isTestMode: createOrderTestShortCircuit,
    });
    if ((buyOrder as any)?.idempotent) {
      botWarn("buyFlow", "idempotent_duplicate_block", { userId, symbol, botId, cycleId });
      return { action: "skip" as const, detail: `Duplicate BUY skipped (cycle) for bot=${botId ?? "n/a"} cycle=${cycleId}` };
    }
    const buyOrderId = toStringValue((buyOrder as any)?.exchange_order_id);
    const executedQty = Number((buyOrder as any)?.amount);
    const filledQty = Number.isFinite(executedQty) && executedQty > 0 ? executedQty : qty;
    const fillAvg = Number((buyOrder as any)?.average ?? (buyOrder as any)?.price);
    const entryForDb = Number.isFinite(fillAvg) && fillAvg > 0
      ? Number(fillAvg.toFixed(8))
      : entryPriceFull;
    const valueUsd = Number((filledQty * entryForDb).toFixed(8));
    const stopLossAtEntry = Number(
      (Math.min(entryForDb * (1 - 1e-8), Math.max(entryForDb - slDistance, entryForDb * 1e-8))).toFixed(8),
    );
    let stopLossPersist = stopLossAtEntry;
    if (!(stopLossPersist < entryForDb)) {
      stopLossPersist = Number((entryForDb * (1 - stopLossPctFraction)).toFixed(8));
    }
    const takeProfitPersist = Number((entryForDb * (1 + takeProfitPct / 100)).toFixed(8));
    let initialTrailingPersist = Number(
      (Math.min(entryForDb * (1 - 1e-8), Math.max(entryForDb - trailDistance, entryForDb * 1e-8))).toFixed(8),
    );
    if (!(initialTrailingPersist < entryForDb)) {
      initialTrailingPersist = Number((entryForDb * (1 - trailingStopPct)).toFixed(8));
    }
    const nextBalance = ghostMode
      ? currentBalance
      : fromUsdCents(toUsdCents(currentBalance) - toUsdCents(valueUsd));
    const boughtAsset = symbol.replace(/USDT$/i, "");
    const proTipLine = ai.pro_tip?.trim()
      ? `\n<b>Pro tip:</b> ${escapeHtml(ai.pro_tip.trim())}`
      : "";
    await sendTelegramAlert(
      (ghostMode
        ? `👻 <b>GHOST BUY</b> (no Binance order): Simulated $${formatUsdAlertAmount(valueUsd)} of ${escapeHtml(boughtAsset)}\n`
        : `🚀 REAL TRADE EXECUTED: Bought $${formatUsdAlertAmount(valueUsd)} of ${escapeHtml(boughtAsset)}\n`) +
        `<b>Effective confidence:</b> ${effectiveConfidence.toFixed(2)}%` +
        (bearish1hCap && rawWeighted > effectiveConfidence
          ? ` (capped from ${rawWeighted.toFixed(2)}%)`
          : "") +
        `${proTipLine}`,
    );

    const weightedPreSentimentVibe = estimatePreSentimentWeightedForRegime(
      ai,
      regime,
      resolvedWeights,
    );
    const aiReasoningJson = buildAiReasoningJson(ai, executionConfidence, {
      raw_weighted: rawWeighted,
      weighted_pre_sentiment_vibe: weightedPreSentimentVibe,
      bearish_1h_cap: bearish1hCap,
      mtf,
      market_regime: regime,
      adx14,
      score_weight_profile: scoreWeightProfile,
      resolved_weights: {
        trend: resolvedWeights.trend,
        momentum: resolvedWeights.momentum,
        volume: resolvedWeights.volume,
        order_book: resolvedWeights.order_book,
      },
      war_room: warRoom,
    });

    await insertTrade(supabase, {
      user_id: userId,
      signalId: buyOrderId ?? `edge-buy-${Date.now()}`,
      exchange_order_id: buyOrderId,
      coinId: coinIdFromSymbol(symbol),
      symbol,
      type: "buy",
      ai_reasoning: aiReasoningJson,
      // Explicit price (trades.price is NOT NULL) + full-precision entry for
      // micro-priced assets. Keeping entry/stop/tp as 8-decimal floats.
      price: entryForDb,
      entryPrice: entryForDb,
      amount: filledQty,
      value: valueUsd,
      status: "open",
      opened_at: openedAt,
      stopLoss: stopLossPersist,
      takeProfit: takeProfitPersist,
      extra: {
        bot_id: botId ?? null,
        cycle_id: cycleId,
        is_paper: isTestMode && !ghostMode,
        is_ghost: ghostMode,
        trade_mode: ghostMode ? "ghost" : isTestMode ? "paper" : "live",
        execution_type: (buyOrder as any)?.execution_type ?? null,
        actual_slippage_pct: (buyOrder as any)?.actual_slippage_pct ?? null,
        smart_execution_meta: (buyOrder as any)?.smart_execution_meta ?? null,
        highest_price_seen: entryForDb,
        highest_price_reached: entryForDb,
        trailing_stop_price: initialTrailingPersist,
        trailing_stop_pct: trailingStopPct,
        atr14_at_entry: Number.isFinite(atr14) && atr14 > 0 ? atr14 : null,
        atr_stop_trail_mult: ATR_STOP_TRAIL_MULTIPLIER,
        vol_burst_widen_mult: vb,
        vol_burst_effective_atr_mult: atrTrailEffective,
        vol_burst_meta: volBurstMeta ?? null,
        stop_loss_distance_price: slDistance,
        trail_distance_price: trailDistance,
        stop_trail_basis: Number.isFinite(atr14) && atr14 > 0
          ? vb > 1.002 ? "atr_burst_guard" : "atr_1p5x"
          : "pct_fallback",
      },
      followedSignal: true,
      notes:
        `Edge BUY | orderId=${buyOrderId ?? "n/a"} | strategy=${strategyNotes} | tech=${technical} ai=${ai.trend} effective=${effectiveConfidence.toFixed(2)}% raw=${rawWeighted.toFixed(2)}%`,
    }, `BOUGHT: ${strategyNotes}`);

    if (!ghostMode) {
      await updateProfileBalance(
        supabase,
        userId,
        nextBalance,
        shouldInitializeStartingBalance ? resolvedStartingBalance : undefined,
      );
    }
    await persistRunTelemetry({ supabase, userId, symbol, action: "buy", detail: `BUY ${filledQty} @ ${formatTelegramPrice(snapshotPrice)}`, balance: nextBalance });
    if (ghostMode) {
      await logMockTrade({
        supabase,
        userId,
        symbol,
        tradeUsd: valueUsd,
        price: entryForDb,
        qty: filledQty,
        strategyNotes,
      });
    }

    await sendTelegramAlert(
      (ghostMode ? `👻 <b>GHOST BUY</b> (DB only)\n` : `🟢 <b>BUY ORDER</b>\n`) +
        `<b>Symbol:</b> ${escapeHtml(symbol)}\n` +
        `<b>Price:</b> ${formatTelegramPrice(snapshotPrice)}\n` +
        `<b>Qty:</b> ${filledQty}\n` +
        `<b>Order Value:</b> ${valueUsd.toFixed(2)} USDT\n` +
        `<b>Balance After:</b> ${nextBalance.toFixed(2)} USDT\n` +
        `<b>Effective confidence:</b> ${effectiveConfidence.toFixed(2)}%` +
        (bearish1hCap && rawWeighted > effectiveConfidence
          ? ` (capped from ${rawWeighted.toFixed(2)}%)\n`
          : "\n") +
        (ai.pro_tip?.trim() ? `<b>Pro tip:</b> ${escapeHtml(ai.pro_tip.trim())}\n` : "") +
        `<b>Strategy:</b> ${escapeHtml(strategyNotes)}`,
    );
    botDebug("buyFlow", "buy_completed", {
      userId,
      symbol,
      qty: filledQty,
      tradeUsd: valueUsd,
      entryPrice: entryForDb,
      atr14,
      slDistance,
      trailDistance,
      stopLoss: stopLossPersist,
      takeProfit: takeProfitPersist,
      nextBalance,
      orderId: buyOrderId ?? "n/a",
      weightedConfidenceRaw: rawWeighted,
      weightedConfidenceEffective: effectiveConfidence,
      bearish1hCap,
    });
    return {
      action: "buy" as const,
      detail: `BUY ${filledQty} @ ${formatTelegramPrice(snapshotPrice)} | order ${buyOrderId ?? "n/a"} | balance ${nextBalance.toFixed(2)}`,
      nextBalance,
    };
  } catch (error) {
    const detail = formatUnknownError(error);
    const lower = detail.toLowerCase();
    const isInsufficientBalance = lower.includes("insufficient");
    const isMinNotional = lower.includes("min notional") || lower.includes("notional");
    const isSlippageLimit = lower.includes("slippage_limit_exceeded");
    const isNoFillNonTrending = lower.includes("smart_limit_no_fill_non_trending");
    console.error(`[buyFlow] execute_buy_failed user=${userId} symbol=${symbol} detail=${detail}`);
    await logBuyFlowFailure({
      supabase,
      userId,
      symbol,
      message: isInsufficientBalance
        ? "exchange_insufficient_balance"
        : isMinNotional
        ? "exchange_min_notional"
        : isSlippageLimit
        ? "slippage_limit_exceeded"
        : isNoFillNonTrending
        ? "smart_limit_no_fill_non_trending"
        : "execute_buy_failed",
      meta: {
        reason: "exchange_or_persist_failure_after_decision_buy",
        detail,
        ai_confidence: Number(ai.ai_confidence),
        weighted_confidence_raw: rawWeighted,
        weighted_confidence_effective: effectiveConfidence,
        bearish_1h_cap: bearish1hCap,
        qty,
        trade_usd: Number(tradeUsd.toFixed(8)),
        snapshot_price: Number(snapshotPrice.toFixed(8)),
        stage: "create_order_or_insert_trade",
      },
    });
    throw error;
  } finally {
    if (reservationId) {
      const { error: releaseErr } = await supabase
        .from("capital_reservations")
        .delete()
        .eq("id", reservationId);
      if (releaseErr) {
        botWarn("buyFlow", "capital_reservation_release_failed", {
          userId,
          symbol,
          reservationId,
          detail: releaseErr.message,
        });
        console.log(
          `[buyFlow] capital_reservation delete failed id=${reservationId} detail=${releaseErr.message}`,
        );
      }
    }
  }
}

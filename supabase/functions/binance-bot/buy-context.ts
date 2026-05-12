// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, MarketRegime } from "./types.ts";
import { MIN_TRADE_USD, TRADING_AMOUNT_USD } from "./constants.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { resolveTradeSizeUsd } from "./trade-store.ts";
import {
  applyConfidenceSizedTradeUsd,
  resolveConfidenceTradeUsdScale,
} from "./trade-size-confidence.ts";
import { escapeHtml } from "./bot-shared.ts";
import { botWarn } from "./bot-debug.ts";
import { computeWeightedConfidenceForRegime, getResolvedScoreWeightsPack } from "./ai-scoring.ts";
import { passesMeanReversionBuyGate } from "./regime-detection.ts";
import { resolveBuyFlowMtfContext } from "./buy-mtf.ts";
import { MIN_ADX_FOR_NON_TRENDING_BUY, ONE_H_BEARISH_MAX_CONFIDENCE } from "./buy-helpers.ts";
import { safeInsertLog } from "./buy-logging.ts";
import { applySymbolTradeUsdFloor } from "./trade-size-floor.ts";
import { resolveGhostMode, resolveTestMode } from "./bot-shared.ts";
import { resolveMinAiConfidenceForRegime } from "./utils.ts";

export async function resolveBuyContextAndSizing(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  marketRegime: MarketRegime;
  snapshotPrice: number;
  snapshotEma200?: number;
  snapshotRsi: number;
  snapshotBbLower: number;
  adx14: number;
  currentBalance: number;
  resolvedStartingBalance: number;
  maxDrawdownLimitPct: number;
  executionUsdScale?: number;
  demoProbeBuy?: boolean;
  signal?: AbortSignal;
}) {
  const {
    supabase, row, userId, symbol, ai, marketRegime, snapshotPrice, snapshotEma200,
    snapshotRsi, snapshotBbLower, adx14, currentBalance, resolvedStartingBalance,
    maxDrawdownLimitPct, executionUsdScale, demoProbeBuy = false, signal,
  } = params;
  const demoProbePaper =
    Boolean(demoProbeBuy) && !Boolean((row as any)?.is_live_trading_enabled);
  if (signal?.aborted) return { skipDetail: "cycle_aborted" };

  const regime: MarketRegime = marketRegime ?? "NEUTRAL";
  const scoreWeightProfile: "trend_following" | "mean_reversion" =
    regime === "RANGING" ? "mean_reversion" : "trend_following";
  const scorePack = getResolvedScoreWeightsPack(row as Record<string, unknown>);
  const resolvedWeights =
    regime === "RANGING" ? scorePack.mr : scorePack.tf;
  const rawWeighted = computeWeightedConfidenceForRegime(ai, regime, resolvedWeights);

  const drawdownPct = resolvedStartingBalance > 0
    ? ((resolvedStartingBalance - currentBalance) / resolvedStartingBalance) * 100
    : 0;
  const ghostMode = resolveGhostMode(row);
  const isPaperOnly = !Boolean((row as any)?.is_live_trading_enabled);
  const hasDrawdownBreach = Number.isFinite(drawdownPct) && drawdownPct > maxDrawdownLimitPct;
  if (hasDrawdownBreach) {
    botWarn("buyFlow", "drawdown_breach_block", {
      userId,
      symbol,
      drawdownPct,
      maxDrawdownLimitPct,
      ghostMode,
      isPaperOnly,
    });
    if (ghostMode) {
      return {
        skipDetail:
          `Ghost BUY skipped: drawdown ${drawdownPct.toFixed(2)}% would breach live safety (autopilot not changed).`,
      };
    }
    if (isPaperOnly) {
      await safeInsertLog(
        supabase,
        {
          user_id: userId,
          symbol,
          level: "info",
          source: "safety",
          message: "drawdown_breach_paper_skip",
          meta: {
            event: "drawdown_breach_paper_skip",
            balance_at_breach: Number(currentBalance.toFixed(2)),
            starting_balance: Number(resolvedStartingBalance.toFixed(2)),
            drawdown_pct: Number(drawdownPct.toFixed(2)),
            limit: Number(maxDrawdownLimitPct.toFixed(2)),
            note: "Paper mode: autopilot intentionally NOT disabled.",
          },
          created_at: new Date().toISOString(),
        },
        "drawdown_breach_paper_skip",
      );
      return {
        skipDetail:
          `Paper BUY skipped: drawdown ${drawdownPct.toFixed(2)}% > ${maxDrawdownLimitPct.toFixed(2)}% (autopilot kept ON for demo).`,
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
    return { skipDetail: `BUY blocked by drawdown breach (${drawdownPct.toFixed(2)}% > ${maxDrawdownLimitPct.toFixed(2)}%)` };
  }

  if (
    regime !== "TRENDING" &&
    Number.isFinite(adx14) &&
    adx14 < MIN_ADX_FOR_NON_TRENDING_BUY
  ) {
    return {
      skipDetail:
        `BUY blocked: regime=${regime} with ADX(14)=${adx14.toFixed(2)} < ${MIN_ADX_FOR_NON_TRENDING_BUY}. Chop is wider than the SL distance — wait for trending follow-through.`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
    };
  }
  if (
    regime === "RANGING" &&
    !passesMeanReversionBuyGate({
      regime,
      rsi: snapshotRsi,
      latestPrice: snapshotPrice,
      bbLower: snapshotBbLower,
    })
  ) {
    return {
      skipDetail:
        "BUY blocked: RANGING regime (ADX<20 + tight BB) — require mean-reversion (RSI<40, RSI<32, or price at lower BB); avoids trend-chasing in chop.",
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
    };
  }

  const isTestMode = resolveTestMode(row);
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
    return {
      skipDetail:
        "BUY blocked: live MTF guard requires valid 1h OHLCV (≥201 bars) and EMA200; fetch failed or data insufficient (No Data = No Trade).",
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      isTestMode,
      mtf,
    };
  }

  const effectiveConfidence = bearish1hCap
    ? Math.min(rawWeighted, ONE_H_BEARISH_MAX_CONFIDENCE)
    : rawWeighted;

  const fixedUsd = Number((row as any)?.trade_size_usd ?? (row as any)?.fixed_trade_usd ?? 0);
  const envTradingAmount = Number(Deno.env.get("TRADING_AMOUNT") ?? TRADING_AMOUNT_USD ?? 0);
  const useEnvTradeAmount = fixedUsd <= 0 && envTradingAmount > 0;
  let baseTradeUsd = useEnvTradeAmount
    ? Math.min(currentBalance, Math.max(MIN_TRADE_USD, envTradingAmount))
    : resolveTradeSizeUsd(row, currentBalance);
  if (!Number.isFinite(baseTradeUsd) || baseTradeUsd < MIN_TRADE_USD) {
    baseTradeUsd = Math.min(currentBalance, MIN_TRADE_USD);
  }
  baseTradeUsd = Math.min(currentBalance, Math.max(MIN_TRADE_USD, baseTradeUsd));

  const minAiConfidence = resolveMinAiConfidenceForRegime(
    row as Record<string, unknown>,
    regime,
  );
  const confidenceSizing = resolveConfidenceTradeUsdScale({
    aiConfidence: Number(ai.ai_confidence),
    weightedConfidence: effectiveConfidence,
    minAiConfidence,
  });
  const tradeUsd = applySymbolTradeUsdFloor({
    symbol,
    tradeUsd: applyConfidenceSizedTradeUsd({
      baseTradeUsd,
      currentBalance,
      minTradeUsd: MIN_TRADE_USD,
      sizing: confidenceSizing,
      executionUsdScale,
      useConfidenceScale: !useEnvTradeAmount && fixedUsd <= 0,
    }),
    currentBalance,
  });
  if (tradeUsd < MIN_TRADE_USD) {
    return {
      skipDetail: `Balance too low for BUY (${currentBalance.toFixed(2)})`,
      rawWeighted,
      resolvedWeights,
      regime,
      scoreWeightProfile,
      ghostMode,
      isPaperOnly,
      demoProbePaper,
      isTestMode,
      mtf,
      effectiveConfidence,
      bearish1hCap,
      tradeUsd,
      baseTradeUsd,
      confidenceSizing,
    };
  }

  return {
    regime,
    scoreWeightProfile,
    resolvedWeights,
    rawWeighted,
    effectiveConfidence,
    ghostMode,
    isPaperOnly,
    demoProbePaper,
    isTestMode,
    mtf,
    bearish1hCap,
    tradeUsd,
    baseTradeUsd,
    confidenceSizing,
  };
}

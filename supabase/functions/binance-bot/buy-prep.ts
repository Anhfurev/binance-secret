// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, MarketRegime } from "./types.ts";
import {
  ATR_STOP_TRAIL_MULTIPLIER,
  VOL_BURST_MAX_ATR_BONUS,
  resolveSpotRoundTripTakerFeePct,
} from "./constants.ts";
import { clamp, toNumber, toStringValue } from "./utils.ts";
import { resolveExchangeSkipped, resolveTestMode } from "./bot-shared.ts";
import { resolvePaperSimulationLiquidityUsdt, resolvePaperWalletUsdt } from "./paper-balance.ts";
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";
import { botDebug, botWarn } from "./bot-debug.ts";
import { volatilityAdjustedDistanceDown } from "./buy-helpers.ts";
import { computeAtrExitLevels } from "./atr-exit-targets.ts";
import { detectDynamicTradingRegime } from "./dynamic-regime-switcher.ts";
import type { IndicatorSnapshot } from "./types.ts";
import { resolveStopLossPctFraction, resolveTakeProfitPctPoints } from "./trade-stop-risk.ts";
import { safeInsertLog } from "./buy-logging.ts";
import {
  calculateQuantityFromRiskToStop,
  loadProfileDemoBalance,
} from "./risk-to-stop-sizing.ts";
import { formatBuyAmountWithinUsdCap } from "./exchange-client.ts";
import { applySymbolTradeUsdFloor } from "./trade-size-floor.ts";

export function resolveBuySizingEquityUsd(params: {
  exchangeSkipped: boolean;
  profileDemoBalance: number | null;
  walletUsdt: number;
}): number {
  const wallet = Math.max(0, toNumber(params.walletUsdt, 0));
  if (!params.exchangeSkipped) return wallet;
  const profile = params.profileDemoBalance;
  return Number.isFinite(profile) && profile > 0 ? profile : wallet;
}

export function capRiskToStopNotionalUsd(params: {
  riskNotionalUsd: number;
  confidenceCapUsd: number;
  walletUsdt: number;
  totalEquityUsd: number;
}): number {
  let tradeUsd = Math.max(0, toNumber(params.riskNotionalUsd, 0));
  const confidenceCapUsd = toNumber(params.confidenceCapUsd, 0);
  if (confidenceCapUsd > 0) tradeUsd = Math.min(tradeUsd, confidenceCapUsd);
  return Math.min(tradeUsd, params.walletUsdt, params.totalEquityUsd);
}

export async function prepareBuyExecution(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  marketRegime: MarketRegime;
  snapshotPrice: number;
  atr14: number;
  adx14?: number;
  trailingStopPct: number;
  volBurstWidenMult?: number;
  volBurstMeta?: Record<string, unknown>;
  tradeUsd: number;
  effectiveConfidence: number;
  rawWeighted: number;
  bearish1hCap: boolean;
  mtf: Record<string, unknown>;
  ghostMode: boolean;
  /** Profile cash for paper/ghost; live callers pass exchange free USDT. */
  walletUsdt: number;
  /** Verified CCXT free USDT — skips DB wallet check for oversold bounce dispatch. */
  oversoldBounceExchangeFree?: number | null;
  /** Sideways grinder: tight TP override (% points, e.g. 1.0 = 1%). */
  takeProfitPctOverride?: number | null;
}) {
  const {
    supabase, row, userId, symbol, ai, marketRegime, snapshotPrice, atr14, adx14 = 0,
    trailingStopPct, volBurstWidenMult = 1, volBurstMeta,
    effectiveConfidence, rawWeighted, bearish1hCap, mtf, ghostMode, walletUsdt,
    takeProfitPctOverride = null,
  } = params;
  /** Must match `resolveTestMode` / `is_live_trading_enabled` — not legacy `is_test_mode`. */
  const isTestMode = resolveTestMode(row);
  const exchangeSkipped = resolveExchangeSkipped(row);
  const isLiveMode = !exchangeSkipped;
  const usdtBalance = exchangeSkipped || isPaperTradingEnvForced()
    ? resolvePaperSimulationLiquidityUsdt(walletUsdt)
    : walletUsdt;
  const profileEquity = exchangeSkipped
    ? await loadProfileDemoBalance(supabase, userId)
    : null;
  const totalEquity = resolveBuySizingEquityUsd({
    exchangeSkipped,
    profileDemoBalance: profileEquity,
    walletUsdt: usdtBalance,
  });
  if (!(totalEquity > 0)) {
    return {
      skipDetail: "BUY skip: total equity unavailable for risk-to-stop sizing",
      usdtBalance,
    };
  }

  const stopLossPct = clamp(toNumber((row as any).stop_loss_pct, 2), 0.1, 50);
  const takeProfitPctRaw = takeProfitPctOverride != null && Number.isFinite(takeProfitPctOverride)
    ? clamp(takeProfitPctOverride, 0.1, 100)
    : clamp(toNumber((row as any).take_profit_pct, 4), 0.1, 100);
  const stopLossPctFraction = resolveStopLossPctFraction(stopLossPct, symbol);
  const takeProfitPct = resolveTakeProfitPctPoints(takeProfitPctRaw, stopLossPct, symbol);
  const gateFees = String(Deno.env.get("MIN_PROFIT_AFTER_FEES_GATE") ?? "1").trim() !== "0";
  if (gateFees) {
    const rawMin = (row as any).min_profit_after_fees_pct;
    let floorNetPct: number | null = null;
    if (rawMin === null || rawMin === undefined) {
      const d = Number(
        String(Deno.env.get("DEFAULT_MIN_PROFIT_AFTER_FEES_PCT") ?? "0.15").trim(),
      );
      floorNetPct = Number.isFinite(d) && d >= 0 ? d : 0.15;
    } else if (Number(rawMin) === 0) {
      floorNetPct = null;
    } else {
      floorNetPct = clamp(toNumber(rawMin, 0.15), 0.01, 50);
    }
    if (floorNetPct != null) {
      const roundTripPctPoints = resolveSpotRoundTripTakerFeePct() * 100;
      const estimatedNetTp = takeProfitPct - roundTripPctPoints;
      if (estimatedNetTp < floorNetPct) {
        return {
          skipDetail:
            `BUY skip: TP ${takeProfitPct.toFixed(2)}% minus est. round-trip fees ${roundTripPctPoints.toFixed(3)}% → net ${estimatedNetTp.toFixed(2)}% < min ${floorNetPct.toFixed(2)}% (min_profit_after_fees_pct / default). Raise take_profit_pct or lower the floor in bot_settings.`,
          usdtBalance,
        };
      }
    }
  }
  const entryPriceFull = Number(snapshotPrice.toFixed(8));
  const VB_MAX = 1 + VOL_BURST_MAX_ATR_BONUS;
  const vbRaw = Number(volBurstWidenMult);
  const vb = Number.isFinite(vbRaw) && vbRaw >= 1 ? Math.min(vbRaw, VB_MAX) : 1;
  const atrTrailEffective = Number((ATR_STOP_TRAIL_MULTIPLIER * vb).toFixed(6));
  const dynRegime = detectDynamicTradingRegime({
    symbol,
    latestPrice: entryPriceFull,
    marketRegime,
    adx14: toNumber(adx14, 0),
    atr14,
  } as IndicatorSnapshot).regime;
  const atrExit = computeAtrExitLevels(entryPriceFull, atr14, {
    regime: dynRegime,
    stopLossPctFraction,
    takeProfitPctFraction: takeProfitPct / 100,
  });
  const slDistance = atrExit.slDistance;
  let stopLossPrice = atrExit.stopLoss;
  if (!(stopLossPrice < entryPriceFull)) {
    stopLossPrice = Number((entryPriceFull * (1 - stopLossPctFraction)).toFixed(8));
  }
  botDebug("buyFlow", "atr_exit_targets_prep", {
    symbol,
    basis: atrExit.basis,
    slAtrMult: atrExit.slAtrMult,
    tpAtrMult: atrExit.tpAtrMult,
    rewardRiskRatio: atrExit.rewardRiskRatio,
    atrPct: atrExit.atrPct,
  });
  const sized = await calculateQuantityFromRiskToStop({
    symbol,
    totalEquity,
    entryPrice: entryPriceFull,
    stopLossPrice,
  });
  const cappedTradeUsd = capRiskToStopNotionalUsd({
    riskNotionalUsd: sized.notionalUsd,
    confidenceCapUsd: params.tradeUsd,
    walletUsdt: usdtBalance,
    totalEquityUsd: totalEquity,
  });
  const tradeUsd = applySymbolTradeUsdFloor({
    symbol,
    tradeUsd: cappedTradeUsd,
    currentBalance: usdtBalance,
  });
  let qty = sized.qty;
  if (tradeUsd > 0 && Math.abs(tradeUsd - sized.notionalUsd) > 1e-8) {
    qty = await formatBuyAmountWithinUsdCap(symbol, tradeUsd, entryPriceFull);
  }
  const sizingMeta = {
    ...sized.sizingMeta,
    confidence_cap_usd: Number(toNumber(params.tradeUsd, 0).toFixed(8)),
    notional_after_confidence_cap_usd: Number(cappedTradeUsd.toFixed(8)),
    notional_after_symbol_floor_usd: Number(tradeUsd.toFixed(8)),
    notional_size_usd: Number(tradeUsd.toFixed(8)),
  };
  const bounceExchangeFree = Number(params.oversoldBounceExchangeFree ?? NaN);
  const bounceExchangeOk = Number.isFinite(bounceExchangeFree) &&
    bounceExchangeFree >= tradeUsd - 1e-6;
  if (!bounceExchangeOk && usdtBalance < tradeUsd) {
    const shortBy = Number((tradeUsd - usdtBalance).toFixed(2));
    return {
      skipDetail: isLiveMode
        ? `LIVE ABORT: wallet_insufficient_funds — need ${tradeUsd.toFixed(2)} USDT, have ${usdtBalance.toFixed(2)} (short ${shortBy.toFixed(2)})`
        : `Insufficient USDT balance (${usdtBalance.toFixed(2)} < ${tradeUsd.toFixed(2)})`,
      usdtBalance,
    };
  }
  if (!(qty > 0) || !(tradeUsd > 0)) {
    return {
      skipDetail: "BUY skip: risk-to-stop sizing produced zero quantity",
      usdtBalance,
    };
  }
  const tpDistance = atrExit.tpDistance;
  const takeProfitPrice = atrExit.takeProfit;
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
          risked_amount_usd: sized.riskUsd,
          notional_size_usd: Number(tradeUsd.toFixed(2)),
        },
        created_at: openedAt,
      },
      "buy_intent_dry_run",
    );
  }

  botDebug("buyFlow", "execution_mode", {
    userId,
    symbol,
    isTestMode,
    ghostMode,
    exchangeSkipped,
    liveExecutionEnabled: !exchangeSkipped,
    aiConfidence: toNumber(ai.ai_confidence, 0),
    marketRegime,
    volBurstMeta: volBurstMeta ?? null,
  });

  return {
    isTestMode,
    exchangeSkipped,
    usdtBalance,
    qty,
    tradeUsd,
    sizingMeta,
    stopLossPctFraction,
    atrTrailEffective,
    vb,
    slDistance,
    takeProfitPrice,
    atrExit,
    trailDistance,
    stopLossPrice,
    initialTrailingStopPrice,
    openedAt,
    botId,
  };
}

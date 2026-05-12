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
import { resolvePaperWalletUsdt } from "./paper-balance.ts";
import { botDebug, botWarn } from "./bot-debug.ts";
import { volatilityAdjustedDistanceDown, takeProfitDistanceUp } from "./buy-helpers.ts";
import { resolveStopLossPctFraction, resolveTakeProfitPctPoints } from "./trade-stop-risk.ts";
import { safeInsertLog } from "./buy-logging.ts";
import { formatBuyAmountWithinUsdCap } from "./exchange-client.ts";

export async function prepareBuyExecution(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  marketRegime: MarketRegime;
  snapshotPrice: number;
  atr14: number;
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
}) {
  const {
    supabase, row, userId, symbol, ai, marketRegime, snapshotPrice, atr14,
    trailingStopPct, volBurstWidenMult = 1, volBurstMeta, tradeUsd,
    effectiveConfidence, rawWeighted, bearish1hCap, mtf, ghostMode, walletUsdt,
  } = params;
  /** Must match `resolveTestMode` / `is_live_trading_enabled` — not legacy `is_test_mode`. */
  const isTestMode = resolveTestMode(row);
  const exchangeSkipped = resolveExchangeSkipped(row);
  const isLiveMode = !exchangeSkipped;
  const usdtBalance = exchangeSkipped
    ? resolvePaperWalletUsdt(walletUsdt)
    : walletUsdt;
  if (usdtBalance < tradeUsd) {
    const shortBy = Number((tradeUsd - usdtBalance).toFixed(2));
    return {
      skipDetail: isLiveMode
        ? `LIVE ABORT: wallet_insufficient_funds — need ${tradeUsd.toFixed(2)} USDT, have ${usdtBalance.toFixed(2)} (short ${shortBy.toFixed(2)})`
        : `Insufficient USDT balance (${usdtBalance.toFixed(2)} < ${tradeUsd.toFixed(2)})`,
      usdtBalance,
    };
  }

  const qty = await formatBuyAmountWithinUsdCap(symbol, tradeUsd, snapshotPrice);
  const stopLossPct = clamp(toNumber((row as any).stop_loss_pct, 2), 0.1, 50);
  const takeProfitPctRaw = clamp(toNumber((row as any).take_profit_pct, 4), 0.1, 100);
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
  const slDistance = Math.max(
    volatilityAdjustedDistanceDown(
      entryPriceFull,
      atr14,
      stopLossPctFraction,
      atrTrailEffective,
    ),
    entryPriceFull * stopLossPctFraction,
  );
  const stopLossRaw = entryPriceFull - slDistance;
  let stopLossPrice = Number(
    Math.min(entryPriceFull * (1 - 1e-8), Math.max(stopLossRaw, entryPriceFull * 1e-8)).toFixed(8),
  );
  if (!(stopLossPrice < entryPriceFull)) {
    stopLossPrice = Number((entryPriceFull * (1 - stopLossPctFraction)).toFixed(8));
  }
  const tpDistance = takeProfitDistanceUp(
    entryPriceFull,
    atr14,
    takeProfitPct / 100,
    slDistance,
  );
  const takeProfitPrice = Number((entryPriceFull + tpDistance).toFixed(8));
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
    stopLossPctFraction,
    atrTrailEffective,
    vb,
    slDistance,
    takeProfitPrice,
    trailDistance,
    stopLossPrice,
    initialTrailingStopPrice,
    openedAt,
    botId,
  };
}

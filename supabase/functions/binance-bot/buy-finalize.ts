// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis } from "./types.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { adjustPaperDemoBalance, insertTrade } from "./trade-store.ts";
import { logMockTrade } from "./buy-logging.ts";
import { persistRunTelemetry } from "./bot-telemetry.ts";
import { syncProfilePortfolioHoldings } from "./portfolio-holdings-sync.ts";
import { escapeHtml, formatTelegramPrice, formatUsdAlertAmount, fromUsdCents, toUsdCents } from "./bot-shared.ts";
import { botDebug } from "./bot-debug.ts";
import { releaseTradeExecutionLock } from "./trade-execution-lock.ts";
import { shouldApplyPaperDemoLedgerDelta } from "./paper-balance.ts";

export async function finalizeBuyExecution(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  ai: AiAnalysis;
  strategyNotes: string;
  botId: string | null;
  cycleId: string;
  buyOrderId: string | null;
  isTestMode: boolean;
  ghostMode: boolean;
  shouldInitializeStartingBalance: boolean;
  resolvedStartingBalance: number;
  currentBalance: number;
  snapshotPrice: number;
  requestedQty: number;
  filledQty: number;
  entryForDb: number;
  valueUsd: number;
  stopLossPersist: number;
  takeProfitPersist: number;
  initialTrailingPersist: number;
  trailingStopPct: number;
  atr14: number;
  atrTrailEffective: number;
  vb: number;
  volBurstMeta?: Record<string, unknown>;
  slDistance: number;
  trailDistance: number;
  atrExitAtFill?: {
    atrPct: number | null;
    slAtrMult: number;
    tpAtrMult: number;
    rewardRiskRatio: number;
    basis: string;
  };
  effectiveConfidence: number;
  rawWeighted: number;
  bearish1hCap: boolean;
  aiReasoningJson: string;
  coinId: string;
  technical: string;
  buyOrder: Record<string, unknown>;
  openedAt: string;
  feeUsdBuy?: number;
  sizingMeta?: Record<string, unknown>;
}) {
  const {
    supabase, userId, symbol, ai, strategyNotes, botId, cycleId, buyOrderId,
    isTestMode, ghostMode, shouldInitializeStartingBalance, resolvedStartingBalance,
    currentBalance, snapshotPrice, requestedQty, filledQty, entryForDb, valueUsd,
    stopLossPersist, takeProfitPersist, initialTrailingPersist, trailingStopPct, atr14,
    atrTrailEffective, vb, volBurstMeta, slDistance, trailDistance, effectiveConfidence,
    rawWeighted, bearish1hCap, aiReasoningJson, coinId, technical, buyOrder, openedAt,
    feeUsdBuy = 0, sizingMeta = {}, atrExitAtFill,
  } = params;

  const buyFeeUsd = Number.isFinite(Number(feeUsdBuy)) && Number(feeUsdBuy) >= 0
    ? Number(Number(feeUsdBuy).toFixed(8))
    : 0;
  let nextBalance = fromUsdCents(
    toUsdCents(currentBalance) - toUsdCents(valueUsd) - toUsdCents(buyFeeUsd),
  );
  const boughtAsset = symbol.replace(/USDT$/i, "");
  const proTipLine = ai.pro_tip?.trim()
    ? `\n<b>Pro tip:</b> ${escapeHtml(ai.pro_tip.trim())}`
    : "";
  const buyModeTitle = ghostMode
    ? "👻 <b>GHOST BUY</b> (no Binance order)"
    : isTestMode
    ? "🧪 <b>PAPER BUY SIMULATED</b>"
    : "🚀 <b>LIVE BUY EXECUTED</b>";

  await insertTrade(supabase, {
    user_id: userId,
    signalId: buyOrderId ?? `edge-buy-${Date.now()}`,
    exchange_order_id: buyOrderId,
    coinId,
    symbol,
    type: "buy",
    ai_reasoning: aiReasoningJson,
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
      atr_pct_at_entry: atrExitAtFill?.atrPct ?? (
        Number.isFinite(atr14) && atr14 > 0 && entryForDb > 0
          ? Number(((atr14 / entryForDb) * 100).toFixed(6))
          : null
      ),
      atr_sl_mult: atrExitAtFill?.slAtrMult ?? 2,
      atr_tp_mult: atrExitAtFill?.tpAtrMult ?? 3.5,
      reward_risk_ratio_at_entry: atrExitAtFill?.rewardRiskRatio ?? null,
      atr_exit_basis: atrExitAtFill?.basis ?? null,
      atr_stop_trail_mult: 1.5,
      vol_burst_widen_mult: vb,
      vol_burst_effective_atr_mult: atrTrailEffective,
      vol_burst_meta: volBurstMeta ?? null,
      stop_loss_distance_price: slDistance,
      trail_distance_price: trailDistance,
      stop_trail_basis: Number.isFinite(atr14) && atr14 > 0
        ? vb > 1.002 ? "atr_burst_guard" : "atr_1p5x"
        : "pct_fallback",
      fee_usd_buy: buyFeeUsd,
      risked_amount_usd: sizingMeta.risked_amount_usd ?? null,
      notional_size_usd: sizingMeta.notional_size_usd ?? valueUsd,
      sizing_model: sizingMeta.sizing_model ?? "risk_to_stop",
      risk_per_trade_pct: sizingMeta.risk_per_trade_pct ?? null,
      notional_cap_fraction: sizingMeta.notional_cap_fraction ?? null,
      total_equity_usd: sizingMeta.total_equity_usd ?? null,
      notional_capped: sizingMeta.notional_capped ?? null,
      confidence_cap_usd: sizingMeta.confidence_cap_usd ?? null,
      governance_execution_confidence: sizingMeta.governance_execution_confidence ?? null,
      chart_execution_confidence: sizingMeta.chart_execution_confidence ?? null,
      governance_trade_usd: sizingMeta.governance_trade_usd ?? null,
      notional_after_confidence_cap_usd:
        sizingMeta.notional_after_confidence_cap_usd ?? sizingMeta.notional_size_usd ?? valueUsd,
      notional_after_symbol_floor_usd:
        sizingMeta.notional_after_symbol_floor_usd ?? sizingMeta.notional_after_confidence_cap_usd ?? valueUsd,
    },
    followedSignal: true,
    notes:
      `Edge BUY | orderId=${buyOrderId ?? "n/a"} | strategy=${strategyNotes} | tech=${technical} ai=${ai.trend} effective=${effectiveConfidence.toFixed(2)}% raw=${rawWeighted.toFixed(2)}%`,
  }, `BOUGHT: ${strategyNotes}`, { skipTradeRowTelegram: true });

  await supabase.from("logs").insert([{
    user_id: userId,
    symbol,
    level: "info",
    source: "execution-quality",
    message: "buy_fill_quality",
    meta: {
      event: "buy_fill_quality",
      requested_qty: Number(requestedQty.toFixed(8)),
      filled_qty: Number(filledQty.toFixed(8)),
      fill_ratio: requestedQty > 0 ? Number((filledQty / requestedQty).toFixed(6)) : null,
      signal_price: Number(snapshotPrice.toFixed(8)),
      entry_price_effective: Number(entryForDb.toFixed(8)),
      execution_type: (buyOrder as any)?.execution_type ?? null,
      slippage_pct: (buyOrder as any)?.actual_slippage_pct ?? null,
      fee_usd: (buyOrder as any)?.smart_execution_meta?.fee_usd ?? null,
      trade_mode: ghostMode ? "ghost" : isTestMode ? "paper" : "live",
    },
    created_at: new Date().toISOString(),
  }]);

  if (shouldApplyPaperDemoLedgerDelta(isTestMode, ghostMode)) {
    if (shouldInitializeStartingBalance && Number.isFinite(resolvedStartingBalance)) {
      const initSb = await supabase
        .from("profiles")
        .update({
          starting_balance: Number(resolvedStartingBalance.toFixed(2)),
          updated_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq("id", userId);
      if (initSb.error) throw initSb.error;
    }
    nextBalance = await adjustPaperDemoBalance(
      supabase,
      userId,
      -(valueUsd + buyFeeUsd),
    );
  }

  if (botId && cycleId) {
    await releaseTradeExecutionLock({
      supabase,
      botId: String(botId),
      cycleId: String(cycleId),
      side: "buy",
    });
  }

  await persistRunTelemetry({ supabase, userId, symbol, action: "buy", detail: `BUY ${filledQty} @ ${formatTelegramPrice(snapshotPrice)}`, balance: nextBalance });
  await syncProfilePortfolioHoldings({
    supabase,
    userId,
    availableUsdt: nextBalance,
    priceByBase: { [symbol.replace(/USDT$/, "")]: snapshotPrice },
  });
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
  const buyOrderLabel = ghostMode
    ? `👻 <b>GHOST BUY</b> (DB only)\n`
    : isTestMode
    ? `🧪 <b>PAPER BUY ORDER</b>\n`
    : `🟢 <b>LIVE BUY ORDER</b>\n`;
  const confTail =
    bearish1hCap && rawWeighted > effectiveConfidence
      ? ` (capped from ${rawWeighted.toFixed(2)}%)`
      : "";
  await sendTelegramAlert(
    `${buyModeTitle}: Bought $${formatUsdAlertAmount(valueUsd)} of ${escapeHtml(boughtAsset)} · ` +
      `<b>conf</b> ${effectiveConfidence.toFixed(2)}%${confTail}${proTipLine}\n\n` +
      buyOrderLabel +
      `<b>Symbol:</b> ${escapeHtml(symbol)}\n` +
      `<b>Price:</b> ${formatTelegramPrice(snapshotPrice)} · <b>Qty:</b> ${filledQty}\n` +
      `<b>Notional:</b> ${valueUsd.toFixed(2)} USDT · <b>Balance after:</b> ${nextBalance.toFixed(2)} USDT\n` +
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
}

// @ts-nocheck
// Realistic paper fill simulator. Goal: paper trades behave like real Binance
// spot orders so flipping `is_live_trading_enabled=true` does NOT change PnL
// dynamics — only the routing target. Models fees, slippage, lot/tick precision.
import { formatAmount, normalizePriceForSymbol } from "./exchange-client.ts";
import {
  resolvePaperSpreadExtraSimBps,
  resolvePaperTakerFeeSimulationPct,
} from "./constants.ts";
import { resolveBookBaseline } from "./paper-fill-baseline.ts";

/** Adverse-fill basis points by regime (roundtrip half-spread + impact). */
const PAPER_SLIPPAGE_BPS_BY_REGIME: Record<string, number> = {
  TRENDING: 4,
  NEUTRAL: 6,
  RANGING: 8,
};

function regimeSlippageBps(regime?: string): number {
  const key = String(regime ?? "NEUTRAL").toUpperCase();
  return PAPER_SLIPPAGE_BPS_BY_REGIME[key] ?? PAPER_SLIPPAGE_BPS_BY_REGIME.NEUTRAL;
}

export async function simulatePaperFill(params: {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  /** Snapshot / signal reference (fallback if ticker book missing). */
  signalPrice: number;
  marketRegime?: string;
  feePct?: number;
  /** Override slippage bps for tests; otherwise derived from regime. */
  slippageBpsOverride?: number;
  /** From `fetchPublicSpotTicker` — buys anchor to ask, sells to bid. */
  tickerBid?: number;
  tickerAsk?: number;
  tickerLast?: number;
}) {
  const {
    symbol, side, amount, signalPrice,
    marketRegime,
    feePct = resolvePaperTakerFeeSimulationPct(),
    slippageBpsOverride,
    tickerBid,
    tickerAsk,
    tickerLast,
  } = params;

  if (!Number.isFinite(signalPrice) || signalPrice <= 0) {
    throw new Error(
      `simulatePaperFill: signalPrice required for paper ${side} (${symbol})`,
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `simulatePaperFill: amount must be > 0 for paper ${side} (${symbol})`,
    );
  }

  const bps =
    Number.isFinite(slippageBpsOverride) && (slippageBpsOverride as number) >= 0
      ? Number(slippageBpsOverride)
      : regimeSlippageBps(marketRegime);
  const slipFraction = bps / 10_000;
  const extraSpreadFrac = resolvePaperSpreadExtraSimBps() / 10_000;

  const { baseline, source: bookSource } = resolveBookBaseline({
    side,
    signalPrice,
    bid: tickerBid,
    ask: tickerAsk,
    last: tickerLast,
  });

  const adverseSign = side === "buy" ? 1 : -1;
  const rawFillPrice =
    baseline * (1 + adverseSign * (slipFraction + extraSpreadFrac));
  const fillPrice = await normalizePriceForSymbol(symbol, rawFillPrice);
  const filledAmountStr = await formatAmount(symbol, amount);
  const filledAmount = Number(filledAmountStr);

  const grossNotional = filledAmount * fillPrice;
  const feeUsd = Number((grossNotional * feePct).toFixed(8));
  // Buyer receives base minus fee in base; seller receives quote minus fee.
  // We collapse both into a single effective `price` so PnL calc downstream
  // treats fee as a price haircut — matches our `fromUsdCents(exit-entry)` math.
  const effectivePrice = side === "buy"
    ? Number(((grossNotional + feeUsd) / filledAmount).toFixed(8))
    : Number(((grossNotional - feeUsd) / filledAmount).toFixed(8));

  const fillPriceRounded = Number(fillPrice.toFixed(8));
  const refForSlip = signalPrice;
  const slippagePct = refForSlip > 0
    ? Number((((fillPrice - refForSlip) / refForSlip) * 100).toFixed(4))
    : 0;

  return {
    exchange_order_id: `paper-${side}-${Date.now()}`,
    symbol,
    side,
    type: "market",
    status: "closed",
    amount: filledAmount,
    price: fillPriceRounded,
    average: effectivePrice,
    execution_type: "paper_market",
    actual_slippage_pct: slippagePct,
    smart_execution_meta: {
      paper: true,
      regime: String(marketRegime ?? "NEUTRAL").toUpperCase(),
      slippage_bps: bps,
      paper_spread_extra_bps: resolvePaperSpreadExtraSimBps(),
      book_baseline_source: bookSource,
      ticker_bid: tickerBid ?? null,
      ticker_ask: tickerAsk ?? null,
      ticker_last: tickerLast ?? null,
      fee_pct: feePct,
      fee_usd: feeUsd,
      fill_price_pre_fee: fillPriceRounded,
      effective_price_post_fee: effectivePrice,
      gross_notional: Number(grossNotional.toFixed(8)),
    },
    testMode: true,
  };
}

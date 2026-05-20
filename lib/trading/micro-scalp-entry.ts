import type { MicroAccelerationHit } from "@/lib/trading/micro-scalp-acceleration";
import { readMicroTrailArmPct } from "@/lib/trading/micro-scalp-trailing";
import {
  readAssumedSlippagePctPerLeg,
  readPaperFeeMode,
  readRoundTripFeePct,
} from "@/lib/trading/paper-trade-economics";
import { resolvePaperLiveMarkPrice } from "@/lib/trading/paper-scalp-mark-price";
import type { CoinData, DemoTrade } from "@/lib/types";

function norm(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

export function buildMicroEntryTrade(params: {
  hit: MicroAccelerationHit;
  marketCoins: CoinData[];
  positionSizeUsdt: number;
}): DemoTrade {
  const sym = norm(params.hit.symbol);
  const signalPrice = params.hit.close;
  const slipPct = readAssumedSlippagePctPerLeg() / 100;
  const entry = Number(
    (
      resolvePaperLiveMarkPrice(sym, params.marketCoins, signalPrice) *
      (1 + slipPct)
    ).toFixed(8),
  );
  const amount = entry > 0 ? params.positionSizeUsdt / entry : 0;
  const stopLoss = Number(
    (entry * (1 - readMicroTrailArmPct() / 100)).toFixed(8),
  );

  return {
    id: `micro-${sym}-${Date.now()}`,
    signalId: "micro-acceleration",
    coinId: sym.replace("USDT", ""),
    symbol: sym,
    type: "buy",
    direction: "LONG",
    leverage: 1,
    marginUsed: params.positionSizeUsdt,
    originalEntryPrice: signalPrice,
    entryPrice: entry,
    amount: Number(amount.toFixed(8)),
    value: params.positionSizeUsdt,
    status: "open",
    stopLoss,
    takeProfit: entry * 1.5,
    openedAt: new Date(),
    highestPriceReached: entry,
    followedSignal: false,
    notes: `accel vol×${params.hit.volumeSpike} roc=${params.hit.rocPct}%`,
    tags: ["micro-scalp", "acceleration"],
    executionNotes: [
      `signal@${signalPrice}`,
      `feeMode=${readPaperFeeMode()} rtFee=${readRoundTripFeePct()}%`,
      `assumedSlip=${readAssumedSlippagePctPerLeg()}%/leg`,
    ],
  };
}

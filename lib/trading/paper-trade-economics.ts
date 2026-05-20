import { defaultScalpingSettings } from "@/lib/trading/settings";

export type PaperFeeMode = "maker" | "taker";

export type TradeCloseEconomics = {
  rawPnlUsdt: number;
  entryFeeUsdt: number;
  exitFeeUsdt: number;
  netPnlUsdt: number;
  rawPnlPct: number;
  netPnlPct: number;
  entrySlippagePct: number;
  exitSlippagePct: number;
  roundTripFeePct: number;
  feeMode: PaperFeeMode;
};

function envNum(key: string, fallback: number): number {
  const n = Number(String(process.env[key] ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function readPaperFeeMode(): PaperFeeMode {
  const raw = String(process.env.PAPER_USE_MAKER_FEES ?? "1").trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "taker" ? "taker" : "maker";
}

export function readLegFeePct(mode: PaperFeeMode = readPaperFeeMode()): number {
  if (mode === "maker") {
    return envNum(
      "PAPER_MAKER_FEE_PCT",
      defaultScalpingSettings.makerFeePct,
    );
  }
  return envNum(
    "PAPER_TAKER_FEE_PCT",
    defaultScalpingSettings.takerFeePct,
  );
}

export function readRoundTripFeePct(mode?: PaperFeeMode): number {
  const leg = readLegFeePct(mode);
  return Number((leg * 2).toFixed(4));
}

export function readAssumedSlippagePctPerLeg(): number {
  return envNum("PAPER_ASSUMED_SLIPPAGE_PCT", 0.04);
}

/** Min ROC / trail gap to beat fees + slippage (default 2× round-trip + 2× slip). */
export function readMinNetEdgePct(): number {
  const env = String(process.env.PAPER_MIN_NET_EDGE_PCT ?? "").trim();
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const slip = readAssumedSlippagePctPerLeg() * 2;
  return Number((readRoundTripFeePct() * 2 + slip).toFixed(4));
}

export function readMinMicroTrailGapPct(): number {
  const env = String(process.env.MICRO_TRAIL_GAP_PCT ?? "").trim();
  const configured = env ? Number(env) : 0.5;
  const floor = readMinNetEdgePct();
  return Number(Math.max(configured, floor * 0.6).toFixed(4));
}

export function computeTradeCloseEconomics(params: {
  entryPrice: number;
  exitPrice: number;
  amount: number;
  notionalUsdt: number;
  isLong: boolean;
  signalEntryPrice?: number;
  signalExitPrice?: number;
  feeMode?: PaperFeeMode;
}): TradeCloseEconomics {
  const feeMode = params.feeMode ?? readPaperFeeMode();
  const legFeePct = readLegFeePct(feeMode) / 100;
  const entryNotional =
    params.notionalUsdt > 0
      ? params.notionalUsdt
      : params.entryPrice * params.amount;
  const exitNotional = params.exitPrice * params.amount;

  const entryFeeUsdt = Number((entryNotional * legFeePct).toFixed(6));
  const exitFeeUsdt = Number((exitNotional * legFeePct).toFixed(6));

  const rawPnlUsdt = params.isLong
    ? Number(
        ((params.exitPrice - params.entryPrice) * params.amount).toFixed(6),
      )
    : Number(
        ((params.entryPrice - params.exitPrice) * params.amount).toFixed(6),
      );

  const netPnlUsdt = Number(
    (rawPnlUsdt - entryFeeUsdt - exitFeeUsdt).toFixed(6),
  );

  const rawPnlPct =
    entryNotional > 0
      ? Number(((rawPnlUsdt / entryNotional) * 100).toFixed(4))
      : 0;
  const netPnlPct =
    entryNotional > 0
      ? Number(((netPnlUsdt / entryNotional) * 100).toFixed(4))
      : 0;

  const sigEntry = params.signalEntryPrice ?? params.entryPrice;
  const sigExit = params.signalExitPrice ?? params.exitPrice;

  const entrySlippagePct =
    sigEntry > 0
      ? Number(
          (
            ((params.entryPrice - sigEntry) / sigEntry) *
            100 *
            (params.isLong ? 1 : -1)
          ).toFixed(4),
        )
      : 0;
  const exitSlippagePct =
    sigExit > 0
      ? Number(
          (
            ((params.exitPrice - sigExit) / sigExit) *
            100 *
            (params.isLong ? -1 : 1)
          ).toFixed(4),
        )
      : 0;

  return {
    rawPnlUsdt,
    entryFeeUsdt,
    exitFeeUsdt,
    netPnlUsdt,
    rawPnlPct,
    netPnlPct,
    entrySlippagePct,
    exitSlippagePct,
    roundTripFeePct: readRoundTripFeePct(feeMode),
    feeMode,
  };
}

export function logTradeEconomicsDebug(params: {
  symbol: string;
  reason: string;
  economics: TradeCloseEconomics;
  entryPrice: number;
  exitPrice: number;
  signalEntry?: number;
  signalExit?: number;
}): void {
  const { economics: e } = params;
  const sigEntry = params.signalEntry ?? params.entryPrice;
  const sigExit = params.signalExit ?? params.exitPrice;

  console.log(
    `[TRADE LOG] ${params.symbol} ${params.reason} | ` +
      `Raw: $${e.rawPnlUsdt.toFixed(4)} (${e.rawPnlPct}%) | ` +
      `Fees: entry $${e.entryFeeUsdt.toFixed(4)} + exit $${e.exitFeeUsdt.toFixed(4)} (${e.feeMode} ${e.roundTripFeePct}% RT) | ` +
      `Net: $${e.netPnlUsdt.toFixed(4)} (${e.netPnlPct}%) | ` +
      `Slip: entry ${e.entrySlippagePct}% exit ${e.exitSlippagePct}% | ` +
      `Signal→Fill entry ${sigEntry}→${params.entryPrice} exit ${sigExit}→${params.exitPrice}`,
  );

  if (e.rawPnlUsdt > 0 && e.netPnlUsdt <= 0) {
    console.warn(
      `[TRADE LOG] ${params.symbol} FEE TRAP — raw win, net loss (widen TP or use maker POST_ONLY)`,
    );
  }
  if (e.rawPnlUsdt <= 0 && e.rawPnlPct > -e.roundTripFeePct) {
    console.warn(
      `[TRADE LOG] ${params.symbol} SIGNAL WEAK — raw move smaller than fee floor; likely chop`,
    );
  }
}

export function passesMinNetEdgeForMove(movePct: number): boolean {
  return movePct >= readMinNetEdgePct();
}

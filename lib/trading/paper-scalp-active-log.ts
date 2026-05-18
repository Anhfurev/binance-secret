import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import {
  evaluatePaperBuySignal,
  type PaperMomentumSettings,
} from "@/lib/trading/paper-scalp-momentum";
import {
  formatAssetPrice,
  formatNavUsd,
} from "@/lib/trading/paper-scalp-metrics-format";

function emaRelation(snap: Scalp1mSnapshot): string {
  if (snap.ema9 > snap.ema21) return "EMA9>EMA21";
  if (snap.ema9 < snap.ema21) return "EMA9<EMA21";
  return "EMA9=EMA21";
}

export function logPaperScalpActiveLine(params: {
  symbol: string;
  action: string;
  reason: string;
  snap?: Scalp1mSnapshot | null;
}): void {
  const { symbol, action, reason, snap } = params;
  if (!snap) {
    console.log(
      `[paper-scalp-active] ${symbol} | ${action} | ${reason} | indicators=unavailable`,
    );
    return;
  }
  console.log(
    `[paper-scalp-active] ${symbol} | ${action} | ${reason} | RSI ${snap.rsi14.toFixed(1)} | ${emaRelation(snap)} (${formatAssetPrice(snap.ema9)} / ${formatAssetPrice(snap.ema21)})`,
  );
}

export function logPaperMarketScan(
  symbols: string[],
  snapshots: Map<string, Scalp1mSnapshot>,
  momentum: PaperMomentumSettings,
): void {
  console.log(`[paper-scalp-active] market scan | ${symbols.length} symbols`);
  for (const raw of symbols) {
    const sym = raw.toUpperCase().replace(/\//g, "");
    const snap = snapshots.get(sym.endsWith("USDT") ? sym : `${sym}USDT`);
    if (!snap) {
      logPaperScalpActiveLine({
        symbol: sym,
        action: "SKIP",
        reason: "no_snapshot",
      });
      continue;
    }
    const evaluation = evaluatePaperBuySignal(snap, momentum);
    const action = evaluation.shouldBuy ? "BUY_CANDIDATE" : "NO_TRADE";
    const reason = evaluation.shouldBuy ? evaluation.reason : evaluation.reason;
    logPaperScalpActiveLine({ symbol: snap.symbol, action, reason, snap });
  }
}

export function logPaperWorkspaceResult(params: {
  workspaceKey: string;
  action: string;
  summary: string;
  navUsdt: number;
  cashUsdt: number;
}): void {
  console.log(
    `[paper-scalp-active] workspace=${params.workspaceKey} | ${params.action} | ${params.summary} | NAV=$${formatNavUsd(params.navUsdt)} | cash=$${formatNavUsd(params.cashUsdt)}`,
  );
}

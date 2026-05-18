import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import type { PaperMomentumSettings } from "@/lib/trading/paper-scalp-momentum";

function verboseLogsEnabled(): boolean {
  return String(process.env.PAPER_VERBOSE_LOGS ?? "").trim() === "1";
}

export function logPaperScalpActiveLine(_params: {
  symbol: string;
  action: string;
  reason: string;
  snap?: Scalp1mSnapshot | null;
}): void {
  if (!verboseLogsEnabled()) return;
}

export function logPaperMarketScan(
  _symbols: string[],
  _snapshots: Map<string, Scalp1mSnapshot>,
  _momentum: PaperMomentumSettings,
): void {
  if (!verboseLogsEnabled()) return;
}

export function logPaperWorkspaceResult(_params: {
  workspaceKey: string;
  action: string;
  summary: string;
  navUsdt: number;
  cashUsdt: number;
}): void {
  if (!verboseLogsEnabled()) return;
}

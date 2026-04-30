import type { AITradeSignal } from "@/lib/types";

export function filterActionableSignals(signals: AITradeSignal[]) {
  return signals.filter(
    (signal) =>
      signal.isActive !== false &&
      (signal.signalType.includes("BUY") || signal.signalType.includes("SELL")),
  );
}

export function rankSignalsByConfidence(signals: AITradeSignal[]) {
  return [...signals].sort((a, b) => b.confidence - a.confidence);
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

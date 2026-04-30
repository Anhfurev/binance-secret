import { AITradeSignal } from "@/lib/types";

export function signalMatchesCustomStrategy(
  signal: AITradeSignal,
  customStrategy: any,
) {
  if (!customStrategy) return true;
  const { config } = customStrategy;
  const indicators = signal.technicalIndicators;

  if (config.useRsi) {
    const rsiOk = signal.signalType.includes("BUY")
      ? indicators.rsi <= config.rsiOversold
      : indicators.rsi >= config.rsiOverbought;
    if (!rsiOk) return false;
  }

  return true; // Simplified for brevity
}

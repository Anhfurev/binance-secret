import { AITradeSignal } from "@/lib/types";

export function checkStrategy(signal: AITradeSignal, config: any) {
  const indicators = signal.technicalIndicators;

  if (config.useRsi) {
    const isOverbought = indicators.rsi >= config.rsiOverbought;
    const isOversold = indicators.rsi <= config.rsiOversold;
    // Return true/false based on signal type
  }

  return true;
}

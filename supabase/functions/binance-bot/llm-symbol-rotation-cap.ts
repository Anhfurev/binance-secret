// @ts-nocheck
/** Bounded rotation cap — fail fast before Edge CPU budget is exhausted. */

export class LlmSymbolRotationCapError extends Error {
  readonly symbol: string;
  readonly lane: string;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;

  constructor(
    symbol: string,
    lane: string,
    attemptsUsed: number,
    maxAttempts: number,
  ) {
    super(
      `[CIRCUIT BREAKER] ${lane} symbol=${symbol} rotation cap ${attemptsUsed}/${maxAttempts}`,
    );
    this.name = "LlmSymbolRotationCapError";
    this.symbol = symbol;
    this.lane = lane;
    this.attemptsUsed = attemptsUsed;
    this.maxAttempts = maxAttempts;
  }
}

export function isLlmSymbolRotationCapError(err: unknown): err is LlmSymbolRotationCapError {
  return err instanceof LlmSymbolRotationCapError;
}

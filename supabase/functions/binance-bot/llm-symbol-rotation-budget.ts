// @ts-nocheck
/** Per-symbol rotation attempts — stops pool drain after consecutive failures. */

export type SymbolRotationBudget = {
  symbol: string;
  lane: string;
  attemptsUsed: number;
  maxAttempts: number;
  hardAborted: boolean;
};

export function readLlmSymbolRotationAttemptsMax(): number {
  const n = Number(Deno.env.get("LLM_SYMBOL_ROTATION_ATTEMPTS_MAX") ?? "3");
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(3, Math.floor(n));
}

export function createSymbolRotationBudget(
  symbol: string,
  lane: string,
): SymbolRotationBudget {
  return {
    symbol: String(symbol ?? "UNKNOWN").toUpperCase(),
    lane,
    attemptsUsed: 0,
    maxAttempts: readLlmSymbolRotationAttemptsMax(),
    hardAborted: false,
  };
}

export function canStartRotationHttpAttempt(budget: SymbolRotationBudget): boolean {
  return !budget.hardAborted && budget.attemptsUsed < budget.maxAttempts;
}

export function markRotationHardAbort(budget: SymbolRotationBudget): void {
  budget.hardAborted = true;
}

export function consumeRotationFailureAttempt(budget: SymbolRotationBudget): void {
  budget.attemptsUsed += 1;
}

export function isRotationBudgetExhausted(budget: SymbolRotationBudget): boolean {
  return budget.hardAborted || budget.attemptsUsed >= budget.maxAttempts;
}

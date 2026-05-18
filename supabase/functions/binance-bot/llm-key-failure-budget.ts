// @ts-nocheck
/** Cap DB cooldown marks per symbol so one bad cycle cannot drain the whole pool. */

const marksBySymbolProvider = new Map<string, number>();

function budgetKey(symbol: string | undefined, provider: string): string {
  return `${String(symbol ?? "UNKNOWN").toUpperCase()}:${provider}`;
}

export function readLlmDbCooldownMarksPerSymbol(): number {
  const n = Number(Deno.env.get("LLM_DB_COOLDOWN_MARKS_PER_SYMBOL") ?? "2");
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(8, Math.floor(n));
}

function markCount(symbol: string | undefined, provider: string): number {
  return marksBySymbolProvider.get(budgetKey(symbol, provider)) ?? 0;
}

/** Inclusive: at cap → no more DB failure writes this symbol/provider. */
export function isLlmDbFailureBudgetExhausted(
  symbol: string | undefined,
  provider: string,
): boolean {
  return markCount(symbol, provider) >= readLlmDbCooldownMarksPerSymbol();
}

export function canPersistLlmKeyDbFailure(
  symbol: string | undefined,
  provider: string,
): boolean {
  return !isLlmDbFailureBudgetExhausted(symbol, provider);
}

export function consumeLlmKeyDbFailureBudget(
  symbol: string | undefined,
  provider: string,
): void {
  const k = budgetKey(symbol, provider);
  marksBySymbolProvider.set(k, (marksBySymbolProvider.get(k) ?? 0) + 1);
}

export function clearLlmKeyDbFailureBudget(): void {
  marksBySymbolProvider.clear();
}

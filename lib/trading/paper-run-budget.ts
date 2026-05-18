export const PAPER_RUN_BUDGET_MS = 9_000;

export function isPaperRunBudgetExceeded(
  startedAtMs: number,
  budgetMs = PAPER_RUN_BUDGET_MS,
): boolean {
  return performance.now() - startedAtMs >= budgetMs;
}

export function remainingPaperRunBudgetMs(
  startedAtMs: number,
  budgetMs = PAPER_RUN_BUDGET_MS,
): number {
  return Math.max(0, budgetMs - (performance.now() - startedAtMs));
}

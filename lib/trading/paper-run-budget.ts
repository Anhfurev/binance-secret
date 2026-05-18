function resolvePaperRunBudgetMs(): number {
  const raw = String(process.env.PAPER_RUN_BUDGET_MS ?? "").trim();
  const n = raw ? Number(raw) : 950;
  if (!Number.isFinite(n) || n < 200) return 950;
  return Math.min(n, 30_000);
}

/** Hot-path budget for in-memory tick + response (DB I/O is async). */
export const PAPER_RUN_BUDGET_MS = resolvePaperRunBudgetMs();

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

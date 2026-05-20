/** Per-workspace loop budget after kline prepare — not total tick time. */
const BUDGET_MS = 3_500;

function resolvePaperRunBudgetMs(): number {
  const raw = String(process.env.PAPER_RUN_BUDGET_MS ?? "").trim();
  const n = raw ? Number(raw) : BUDGET_MS;
  if (!Number.isFinite(n) || n < 500) return BUDGET_MS;
  return Math.min(n, 30_000);
}

/** Hot-path budget for workspace ticks (prepare/harvest excluded). */
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

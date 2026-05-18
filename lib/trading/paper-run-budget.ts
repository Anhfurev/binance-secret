/** Temporarily lifted for Next.js dev server overhead while testing all workspaces. */
const BUDGET_MS = 4_000;

function resolvePaperRunBudgetMs(): number {
  const raw = String(process.env.PAPER_RUN_BUDGET_MS ?? "").trim();
  const n = raw ? Number(raw) : BUDGET_MS;
  if (!Number.isFinite(n) || n < 200) return BUDGET_MS;
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

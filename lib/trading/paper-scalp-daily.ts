import type { DemoAccount } from "@/lib/types";

/** Reset daily P&L and circuit breaker at UTC day boundary. */
export function maybeResetPaperDailyPnl(account: DemoAccount): DemoAccount {
  const today = new Date().toISOString().slice(0, 10);
  if (account.dailyPnlResetDate === today) return account;
  return {
    ...account,
    dailyPnl: 0,
    dailyPnlResetDate: today,
    circuitBreakerTripped: false,
  };
}

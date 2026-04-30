import { DemoAccount, DemoTrade } from "@/lib/types";

export const DEMO_KEYS = {
  ACCOUNT: "nextrade-demo-account",
  PROFILES: "nextrade-demo-accounts",
  ACTIVE: "nextrade-active-demo-account",
};

export function serializeAccount(account: DemoAccount) {
  return JSON.stringify({
    ...account,
    createdAt: account.createdAt.toISOString(),
    openPositions: account.openPositions.map((t) => ({
      ...t,
      openedAt: t.openedAt.toISOString(),
    })),
  });
}

export function hydrateAccount(raw: string): DemoAccount | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      openPositions: parsed.openPositions.map((t: any) => ({
        ...t,
        openedAt: new Date(t.openedAt),
      })),
    };
  } catch {
    return null;
  }
}

export function calculateWinRate(history: DemoTrade[]) {
  if (history.length === 0) return 0;
  const wins = history.filter((t) => (t.pnl ?? 0) > 0).length;
  return (wins / history.length) * 100;
}

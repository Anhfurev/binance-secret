import { DemoAccount, DemoTrade, DemoAccountProfile } from "@/lib/types";
import { mockDemoAccount } from "@/lib/demo-data";

export const DEMO_KEYS = {
  STORAGE: "nextrade-demo-account",
  PROFILES: "nextrade-demo-accounts",
  ACTIVE: "nextrade-active-demo-account",
};

export function hydrateAccount(raw: string): DemoAccount | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: new Date(parsed.expiresAt),
      openPositions: (parsed.openPositions ?? []).map((t: any) => ({
        ...t,
        openedAt: new Date(t.openedAt),
        closedAt: t.closedAt ? new Date(t.closedAt) : undefined,
      })),
      tradeHistory: (parsed.tradeHistory ?? []).map((t: any) => ({
        ...t,
        openedAt: new Date(t.openedAt),
        closedAt: t.closedAt ? new Date(t.closedAt) : undefined,
      })),
    };
  } catch {
    return null;
  }
}

export function serializeAccount(account: DemoAccount): string {
  return JSON.stringify(account);
}

export function cloneDemoAccount(): DemoAccount {
  return {
    ...mockDemoAccount,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    openPositions: [],
    tradeHistory: [],
  };
}

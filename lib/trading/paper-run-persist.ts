import {
  saveDemoWorkspaceForOwner,
  type DemoWorkspaceOwnerType,
  type DemoWorkspaceSnapshot,
} from "@/lib/supabase-demo";
import { writeServerLogFromError } from "@/lib/server-logs";
import {
  ensurePaperWorkspaceBaseline,
  recordPaperPortfolioSnapshot,
  type PaperWorkspaceDbCtx,
} from "@/lib/trading/paper-portfolio-db";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import { queuePaperTradesSync } from "@/lib/trading/paper-trades-sync";
import type { CoinData, DemoAccount } from "@/lib/types";

export type PaperPersistOutcome = {
  workspaceKey: string;
  ok: boolean;
  error?: string;
};

/** Fire-and-forget Supabase upsert — does not block the paper route response. */
export function queuePaperWorkspacePersist(params: {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  workspaceKey: string;
  snapshot: DemoWorkspaceSnapshot;
  account: DemoAccount;
  dbCtx?: PaperWorkspaceDbCtx | null;
  marketCoins?: CoinData[];
  onSettled?: (outcome: PaperPersistOutcome) => void;
}): void {
  const {
    ownerType,
    ownerId,
    workspaceKey,
    snapshot,
    account,
    dbCtx,
    marketCoins = [],
    onSettled,
  } = params;

  queuePaperTradesSync({
    ownerType,
    ownerId,
    workspaceKey,
    account,
  });

  if (dbCtx) {
    void (async () => {
      await ensurePaperWorkspaceBaseline({ ctx: dbCtx, account });
      const nav = computePaperWorkspaceNav(account, marketCoins);
      await recordPaperPortfolioSnapshot({
        ctx: dbCtx,
        nav,
        openLegCount: account.openPositions.length,
      });
    })().catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn("[paper-portfolio-db] async snapshot failed", {
        workspaceKey,
        message: err.message,
      });
    });
  }

  void saveDemoWorkspaceForOwner(ownerType, ownerId, snapshot)
    .then((saveResult) => {
      if (!saveResult.ok) {
        console.warn("[paper-scalp] async persist failed", {
          workspaceKey,
          error: saveResult.error,
        });
      }
      onSettled?.({
        workspaceKey,
        ok: saveResult.ok,
        error: saveResult.error,
      });
    })
    .catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      writeServerLogFromError("paper-scalp-persist", err, {
        workspaceKey,
        phase: "async_workspace_save",
      });
      onSettled?.({ workspaceKey, ok: false, error: err.message });
    });
}

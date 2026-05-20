import {
  saveDemoWorkspaceForOwner,
  type DemoWorkspaceOwnerType,
  type DemoWorkspaceSnapshot,
} from "@/lib/supabase-demo";
import { writeServerLogFromError } from "@/lib/server-logs";
import type { PaperWorkspaceDbCtx } from "@/lib/trading/paper-portfolio-db";
import { applyLiveProfileNav } from "@/lib/trading/paper-profile-live";
import { queuePaperTradesSync } from "@/lib/trading/paper-trades-sync";
import { resolvePaperTradesUserId } from "@/lib/trading/paper-db-user";
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

  const userId =
    dbCtx?.userId ?? resolvePaperTradesUserId(ownerType, ownerId);

  if (dbCtx && userId) {
    void (async () => {
      await applyLiveProfileNav({
        userId,
        account,
        marketCoins,
        dbCtx,
      });
    })().catch((error: unknown) => {
      if (process.env.PAPER_DEBUG !== "1") return;
      const err = error instanceof Error ? error : new Error(String(error));
      console.log("[paper-profile-live] async persist failed", {
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

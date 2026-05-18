import {
  saveDemoWorkspaceForOwner,
  type DemoWorkspaceOwnerType,
  type DemoWorkspaceSnapshot,
} from "@/lib/supabase-demo";
import { writeServerLogFromError } from "@/lib/server-logs";

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
  onSettled?: (outcome: PaperPersistOutcome) => void;
}): void {
  const { ownerType, ownerId, workspaceKey, snapshot, onSettled } = params;

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

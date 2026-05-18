import type { DemoWorkspaceRecord } from "@/lib/supabase-demo";

export function resolvePaperTelegramMasterWorkspaceKey(
  workspaces: DemoWorkspaceRecord[],
): string | null {
  const envMaster = String(
    process.env.PAPER_TELEGRAM_MASTER_DEVICE_ID ?? "",
  ).trim();
  if (envMaster) {
    for (const ws of workspaces) {
      const key = `${ws.ownerType}:${ws.ownerId}`;
      if (ws.ownerId === envMaster) return key;
    }
  }
  const device = workspaces.find((ws) => ws.ownerType === "device");
  const pick = device ?? workspaces[0];
  return pick ? `${pick.ownerType}:${pick.ownerId}` : null;
}

import type { DemoWorkspaceRecord } from "@/lib/supabase-demo";

const TELEGRAM_DEDUP_MS = 60_000;
const lastTelegramSentAt = new Map<string, number>();

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

export function buildPaperTelegramDedupKey(
  action: string,
  summary: string,
  symbol?: string,
): string {
  const sym =
    symbol ??
    (summary.startsWith("opened:") || summary.startsWith("closed:")
      ? summary.split(":")[1]?.toUpperCase()
      : undefined);
  return `${action}|${sym ?? "all"}|${summary.split(":")[0]}`;
}

function isTelegramDuplicate(key: string): boolean {
  const now = Date.now();
  const prev = lastTelegramSentAt.get(key) ?? 0;
  if (now - prev < TELEGRAM_DEDUP_MS) return true;
  lastTelegramSentAt.set(key, now);
  return false;
}

/** Master workspace only + 60s symbol/action dedup. */
export function shouldDispatchPaperScalpTelegram(params: {
  workspaceKey: string;
  masterWorkspaceKey: string | null;
  action: string;
  summary: string;
}): boolean {
  const { workspaceKey, masterWorkspaceKey, action, summary } = params;
  if (masterWorkspaceKey && workspaceKey !== masterWorkspaceKey) {
    return false;
  }
  const dedupKey = buildPaperTelegramDedupKey(action, summary);
  if (isTelegramDuplicate(dedupKey)) {
    return false;
  }
  return true;
}

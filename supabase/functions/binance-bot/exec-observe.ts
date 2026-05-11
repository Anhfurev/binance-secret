// @ts-nocheck
/** Opt-in structured one-line logs: set EXEC_OBSERVE=1 on the Edge function. */

export function execObserveEnabled(): boolean {
  return String(Deno.env.get("EXEC_OBSERVE") ?? "").trim() === "1";
}

export function execObserve(event: string, meta: Record<string, unknown>): void {
  if (!execObserveEnabled()) return;
  try {
    console.info(`[exec_observe] ${event} ${JSON.stringify(meta)}`);
  } catch {
    console.info(`[exec_observe] ${event}`);
  }
}

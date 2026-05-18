// @ts-nocheck
/** Supabase Edge vs dedicated-server lifecycle helpers. */

export type EdgeRuntimeGlobal = {
  EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
};

export function isSupabaseEdgeRuntime(): boolean {
  const er = (globalThis as EdgeRuntimeGlobal).EdgeRuntime;
  return typeof er !== "undefined" && typeof er.waitUntil === "function";
}

/**
 * Supabase: `EdgeRuntime.waitUntil(promise)` keeps work alive after HTTP response.
 * Dedicated server: detached promise (same pattern, no proprietary global).
 */
export function edgeWaitUntil(promise: Promise<unknown>): void {
  if (isSupabaseEdgeRuntime()) {
    (globalThis as EdgeRuntimeGlobal).EdgeRuntime!.waitUntil!(promise);
    return;
  }
  void promise.catch((err) => {
    console.error(
      "[edge-runtime] detached_task_failed:",
      err instanceof Error ? err.message : String(err),
    );
  });
}

/**
 * Post-response side work — prefers `waitUntil` on Supabase Edge.
 */
export function fireAndForgetSideEffect(
  taskName: string,
  run: () => Promise<unknown>,
): void {
  edgeWaitUntil(
    Promise.resolve()
      .then(run)
      .catch((err) => {
        console.error(
          `[fire-and-forget] ${taskName}:`,
          err instanceof Error ? err.message : String(err),
        );
      }),
  );
}

export function mergeAbortSignals(
  signals: Array<AbortSignal | undefined | null>,
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

export function readGatewayFetchTimeoutMs(): number {
  const raw = String(Deno.env.get("GATEWAY_FETCH_TIMEOUT_MS") ?? "12000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 12_000;
  return Math.min(30_000, Math.max(2_000, Math.floor(n)));
}

export function readTelegramFetchTimeoutMs(): number {
  const raw = String(Deno.env.get("TELEGRAM_FETCH_TIMEOUT_MS") ?? "8000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 8_000;
  return Math.min(20_000, Math.max(2_000, Math.floor(n)));
}

export async function maybeFlushSentryBeforeResponse(): Promise<void> {
  if (Deno.env.get("SENTRY_FLUSH_ON_RESPONSE") !== "1") return;
  try {
    const dsn = (Deno.env.get("SENTRY_DSN") ?? "").trim();
    if (!dsn) return;
    const Sentry = await import("@sentry/deno");
    await Sentry.flush(500);
  } catch {
    // non-fatal
  }
}

export async function finalizeEdgeJsonResponse(response: Response): Promise<Response> {
  await maybeFlushSentryBeforeResponse();
  return response;
}

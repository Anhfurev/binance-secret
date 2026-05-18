/**
 * Server-side writes to public.logs (Next.js routes). Fire-and-forget safe.
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export type ServerLogLevel = "error" | "warn" | "info";

export type WriteServerLogParams = {
  level: ServerLogLevel;
  source: string;
  message: string;
  symbol?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
};

export async function writeServerLog(
  params: WriteServerLogParams,
): Promise<void> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;

  const row = {
    level: params.level,
    source: params.source,
    message: params.message.slice(0, 500),
    symbol: params.symbol ?? null,
    user_id: params.userId ?? null,
    meta: {
      ...(params.meta ?? {}),
      event: params.message,
      logged_at: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("logs").insert([row]);
  if (error) {
    console.error("[server-logs] insert failed:", error.message);
  }
}

/** Non-blocking — never await in hot paths. */
export function writeServerLogAsync(params: WriteServerLogParams): void {
  setImmediate(() => {
    void writeServerLog(params).catch((err) => {
      console.error("[server-logs] async insert error:", err);
    });
  });
}

export function writeServerLogFromError(
  source: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  writeServerLogAsync({
    level: "error",
    source,
    message: err.message.slice(0, 500) || "unknown_error",
    meta: {
      ...meta,
      stack: err.stack?.slice(0, 2000),
      cause: err.cause != null ? String(err.cause) : undefined,
    },
  });
}

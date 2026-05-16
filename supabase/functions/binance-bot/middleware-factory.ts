// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_SYMBOL } from "./constants.ts";
import { formatUnknownError, jsonResponse, normalizeSymbol, toStringValue } from "./utils.ts";
import { safeExecute } from "./safe-execute.ts";
import { botDebug, botError, botWarn, emitSentryFatalException } from "./bot-debug.ts";
import { sendDebuggerExceptionTelegram } from "./debugger-alerts.ts";
import { isTransientPostgrestError } from "./postgrest-errors.ts";

export function parseSymbolsFromBody(parsedBody: Record<string, unknown> | null, searchParams?: URLSearchParams): string[] {
  const rawList = parsedBody?.symbols;
  if (Array.isArray(rawList)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      const s = toStringValue(item);
      if (!s) continue;
      const n = normalizeSymbol(s, DEFAULT_SYMBOL);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }
  const single = toStringValue(parsedBody?.symbol) ?? toStringValue(parsedBody?.ticker);
  if (single) return [normalizeSymbol(single, DEFAULT_SYMBOL)];
  if (!searchParams) return [];
  const q = toStringValue(searchParams.get("symbol")) ?? toStringValue(searchParams.get("ticker"));
  return q ? [normalizeSymbol(q, DEFAULT_SYMBOL)] : [];
}

export function truthyTradingViewFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const s = value.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export function isTradingViewWebhookRequest(parsedBody: Record<string, unknown> | null, url: URL): boolean {
  return url.searchParams.get("tv_webhook") === "1" || truthyTradingViewFlag(parsedBody?.tradingview_webhook);
}

export function resolveTradingViewAuth(parsedBody: Record<string, unknown> | null, url: URL): { ok: boolean; providedTvSecret: string } {
  const env = (Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET") ?? "").trim();
  if (!env) return { ok: false, providedTvSecret: "" };
  const provided = (toStringValue(parsedBody?.tv_secret) ?? toStringValue(url.searchParams.get("tv_secret")) ?? "").trim();
  return { ok: provided === env && provided.length > 0, providedTvSecret: provided };
}

export async function persistEdgeFatalLog(
  supabase: ReturnType<typeof createClient> | null,
  message: string,
  meta: Record<string, unknown> = {},
  level: "error" | "warn" = "error",
) {
  if (!supabase) return;
  try {
    await supabase.from("logs").insert([{
      level,
      source: "edge-fatal",
      message: message.slice(0, 500),
      meta: { event: "edge_fatal", ...meta },
      created_at: new Date().toISOString(),
    }]);
  } catch (e) {
    await safeExecute("catch_persist_edge_fatal_log_failed", () => supabase.from("logs").insert([{
      level: "error",
      source: "edge-fatal",
      message: "persist_edge_fatal_log_failed",
      meta: { event: "persist_edge_fatal_log_failed", detail: formatUnknownError(e) },
      created_at: new Date().toISOString(),
    }]), undefined);
  }
}

export function readEdgeGlobalTimeoutMs(): number {
  const raw = String(Deno.env.get("EDGE_GLOBAL_TIMEOUT_MS") ?? "").trim();
  const n = raw.length ? Number(raw) : NaN;
  /** Default 95s: typical batch ~32–40s; floor 60s avoids `previous_cycle_in_flight` while a batch still runs. */
  if (!Number.isFinite(n)) return 95_000;
  return Math.min(150_000, Math.max(60_000, Math.floor(n)));
}

export async function withFatalBoundary(
  sharedSupabase: ReturnType<typeof createClient>,
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (fatal) {
    const message = formatUnknownError(fatal);
    const transientDb = isTransientPostgrestError(fatal);
    if (transientDb) botWarn("index", "fatal_boundary_transient", { message });
    else botError("index", "fatal_boundary", { message, rawError: fatal });
    await safeExecute("catch_fatal_boundary_log", () => sharedSupabase.from("logs").insert([{
      level: transientDb ? "warn" : "error",
      source: "edge-fatal",
      message: "fatal_boundary",
      meta: { event: "fatal_boundary", detail: message, transient: transientDb },
      created_at: new Date().toISOString(),
    }]), undefined);
    await emitSentryFatalException(fatal, { stage: "deno_serve" });
    await persistEdgeFatalLog(sharedSupabase, message, { stage: "deno_serve", transient: transientDb }, transientDb ? "warn" : "error");
    if (!transientDb) {
      void sendDebuggerExceptionTelegram({
        scope: "fatal_boundary|deno_serve",
        detail: message,
      });
    }
    return jsonResponse({ ok: false, error: message, recovered: true }, 200);
  }
}

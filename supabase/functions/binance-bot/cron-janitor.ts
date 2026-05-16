// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { botDebug } from "./bot-debug.ts";
import { formatUnknownError, jsonResponse, toStringValue } from "./utils.ts";
import { parseStaleMs } from "./trade-execution-lock-config.ts";
import { safeExecute } from "./safe-execute.ts";

export function readReservationStaleMs(): number {
  const n = Number(String(Deno.env.get("CAPITAL_RESERVATION_STALE_MS") ?? "").trim());
  return Number.isFinite(n) && n >= 30_000 ? Math.min(600_000, Math.floor(n)) : 300_000;
}

export async function runCronJanitor(params: {
  supabase: ReturnType<typeof createClient>;
  symbols: string[];
  batchId: string;
}) {
  const { supabase, symbols, batchId } = params;
  const { data: globalStopRows, error: globalStopError } = await supabase.from("profiles").select("id,global_stop").eq("global_stop", true).limit(1);
  if (globalStopError) throw globalStopError;
  if ((globalStopRows ?? []).length > 0) {
    const stopRow = (globalStopRows ?? [])[0] as Record<string, unknown>;
    botDebug("index", "global_stop_active", { n_symbols: symbols.length, profile_id: toStringValue(stopRow?.id) });
    return {
      blocked: true as const,
      response: jsonResponse({ ok: true, skipped: true, reason: "global_stop_enabled", batch_id: batchId }),
    };
  }
  const now = Date.now();
  const lockCut = new Date(now - parseStaleMs(String(Deno.env.get("TRADE_EXEC_LOCK_STALE_MS") ?? ""))).toISOString();
  const reservationCut = new Date(now - readReservationStaleMs()).toISOString();
  await Promise.all([
    safeExecute("cron_trade_execution_lock_prune", () => supabase.from("trade_execution_locks").delete().lt("created_at", lockCut), null),
    safeExecute("cron_capital_reservation_prune", () => supabase.from("capital_reservations").delete().lt("created_at", reservationCut), null),
  ]);
  return { blocked: false as const };
}

export async function tryRunCronJanitor(params: {
  supabase: ReturnType<typeof createClient>;
  symbols: string[];
  batchId: string;
}) {
  const { supabase, symbols, batchId } = params;
  try {
    return await runCronJanitor({ supabase, symbols, batchId });
  } catch (error) {
    const detail = formatUnknownError(error);
    if (detail.includes("profiles.global_stop")) {
      botDebug("index", "global_stop_column_missing", { n_symbols: symbols.length, detail });
      await safeExecute("catch_global_stop_column_missing_log", () => supabase.from("logs").insert([{
        level: "warn",
        source: "runtime",
        message: "global_stop_column_missing",
        meta: { event: "global_stop_column_missing", detail },
        created_at: new Date().toISOString(),
      }]), undefined);
      return { blocked: false as const };
    }
    throw error;
  }
}

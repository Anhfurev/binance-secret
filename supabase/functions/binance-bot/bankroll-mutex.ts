// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { toStringValue } from "./utils.ts";

function readMode(): "skip" | "wait" {
  const mode = String(Deno.env.get("BANKROLL_MUTEX_MODE") ?? "skip").trim().toLowerCase();
  return mode === "wait" ? "wait" : "skip";
}

function readWaitTimeoutMs(): number {
  const n = Number(String(Deno.env.get("BANKROLL_MUTEX_WAIT_TIMEOUT_MS") ?? "").trim());
  return Number.isFinite(n) && n >= 500 ? Math.min(60_000, Math.floor(n)) : 8_000;
}

function readPollMs(): number {
  const n = Number(String(Deno.env.get("BANKROLL_MUTEX_POLL_MS") ?? "").trim());
  return Number.isFinite(n) && n >= 100 ? Math.min(5_000, Math.floor(n)) : 500;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function detectConflicts(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
}) {
  const { supabase, userId, symbol } = params;
  const [reservationRows, lockRows] = await Promise.all([
    supabase.from("capital_reservations").select("symbol,created_at").eq("user_id", userId).limit(20),
    supabase.from("trade_execution_locks").select("symbol,side,created_at").eq("user_id", userId).eq("side", "buy").limit(20),
  ]);
  const otherReservations = (reservationRows.data ?? []).filter((r: any) => {
    const sym = toStringValue(r?.symbol);
    return !sym || sym !== symbol;
  });
  const otherLocks = (lockRows.data ?? []).filter((r: any) => {
    const sym = toStringValue(r?.symbol);
    return !sym || sym !== symbol;
  });
  return {
    blocked: otherReservations.length > 0 || otherLocks.length > 0,
    reservations: otherReservations.length,
    locks: otherLocks.length,
    reservationError: reservationRows.error?.message ?? null,
    lockError: lockRows.error?.message ?? null,
  };
}

export async function enforceBankrollMutex(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
}) {
  const { supabase, userId, symbol } = params;
  const mode = readMode();
  const timeoutMs = readWaitTimeoutMs();
  const pollMs = readPollMs();
  const started = Date.now();
  while (true) {
    const conflicts = await detectConflicts({ supabase, userId, symbol });
    if (!conflicts.blocked) return { allowed: true as const, mode, waitedMs: Date.now() - started };
    if (mode === "skip") {
      return {
        allowed: false as const,
        mode,
        waitedMs: Date.now() - started,
        detail: `bankroll_mutex_skip: other_symbol_inflight reservations=${conflicts.reservations} locks=${conflicts.locks}`,
      };
    }
    if (Date.now() - started >= timeoutMs) {
      return {
        allowed: false as const,
        mode,
        waitedMs: Date.now() - started,
        detail: `bankroll_mutex_wait_timeout:${timeoutMs}ms reservations=${conflicts.reservations} locks=${conflicts.locks}`,
      };
    }
    await sleep(pollMs);
  }
}

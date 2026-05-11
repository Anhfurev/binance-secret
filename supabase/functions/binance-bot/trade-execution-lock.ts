// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import {
  parsePruneMinIntervalMs,
  parseStaleMs,
  shouldRunStaleLockPrune,
} from "./trade-execution-lock-config.ts";
import { execObserve } from "./exec-observe.ts";

function lockDisabled(): boolean {
  return String(Deno.env.get("TRADE_EXEC_LOCK_DISABLE") ?? "0").trim() === "1";
}

function staleMs(): number {
  return parseStaleMs(String(Deno.env.get("TRADE_EXEC_LOCK_STALE_MS") ?? ""));
}

let lastStalePruneAtMs = 0;

function pruneMinIntervalMs(): number {
  return parsePruneMinIntervalMs(
    String(Deno.env.get("TRADE_EXEC_LOCK_PRUNE_MIN_INTERVAL_MS") ?? ""),
  );
}

export async function tryClaimTradeExecutionLock(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  botId: string;
  cycleId: string;
}): Promise<"claimed" | "duplicate"> {
  if (lockDisabled()) return "claimed";
  const { supabase, userId, symbol, side, botId, cycleId } = params;
  const now = Date.now();
  const minGap = pruneMinIntervalMs();
  if (shouldRunStaleLockPrune(lastStalePruneAtMs, now, minGap)) {
    lastStalePruneAtMs = now;
    const cut = new Date(now - staleMs()).toISOString();
    const pr = await supabase.from("trade_execution_locks").delete().lt("created_at", cut);
    execObserve("trade_lock_stale_prune", {
      botId,
      cycleId,
      side,
      cut,
      error: pr.error?.message ?? null,
    });
  }

  const ins = await supabase.from("trade_execution_locks").insert({
    user_id: userId,
    symbol,
    side,
    bot_id: botId,
    cycle_id: cycleId,
  });
  if (!ins.error) {
    execObserve("trade_lock_claimed", { botId, cycleId, side, symbol });
    return "claimed";
  }

  const code = String((ins.error as any)?.code ?? "");
  const msg = String(ins.error?.message ?? "");
  const dup =
    code === "23505" ||
    msg.includes("duplicate key") ||
    msg.includes("unique constraint");
  if (!dup) {
    console.warn(`[trade_execution_locks] insert failed: ${code} ${msg}`);
    execObserve("trade_lock_insert_error", { botId, cycleId, side, code, msg });
    return "claimed";
  }
  execObserve("trade_lock_duplicate", { botId, cycleId, side, symbol });
  return "duplicate";
}

export async function releaseTradeExecutionLock(params: {
  supabase: ReturnType<typeof createClient>;
  botId: string;
  cycleId: string;
  side: "buy" | "sell";
}): Promise<void> {
  if (lockDisabled()) return;
  const { supabase, botId, cycleId, side } = params;
  const del = await supabase
    .from("trade_execution_locks")
    .delete()
    .eq("bot_id", botId)
    .eq("cycle_id", cycleId)
    .eq("side", side);
  execObserve("trade_lock_released", {
    botId,
    cycleId,
    side,
    error: del.error?.message ?? null,
  });
}

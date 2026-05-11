// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { toStringValue } from "./utils.ts";
import { tryClaimTradeExecutionLock } from "./trade-execution-lock.ts";
import { execObserve } from "./exec-observe.ts";

type Idempotent = {
  idempotent: true;
  exchange_order_id: string | null;
  status: string;
  symbol: string;
  side: string;
  amount: number;
};

export async function preflightCreateOrderIdempotencyAndLock(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  sideType: string;
  amount: number;
  botId?: string;
  cycleId?: string;
}): Promise<
  | { action: "idempotent"; payload: Idempotent }
  | { action: "proceed" }
> {
  const { supabase, userId, symbol, sideType, amount, botId, cycleId } = params;
  if (!botId || !cycleId) return { action: "proceed" };

  const existing = await supabase
    .from("trades")
    .select("id, exchange_order_id, signalId")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .eq("type", sideType)
    .eq("extra->>bot_id", botId)
    .eq("extra->>cycle_id", cycleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`Idempotency lookup failed: ${existing.error.message}`);
  }

  if (existing.data) {
    const exchangeOrderId = toStringValue((existing.data as any)?.exchange_order_id);
    const signalId = toStringValue((existing.data as any)?.signalId);
    const payload: Idempotent = {
      idempotent: true,
      exchange_order_id: exchangeOrderId ?? signalId ?? null,
      status: "duplicate_skipped",
      symbol,
      side: sideType,
      amount,
    };
    execObserve("create_order_idempotent_trade", { symbol, side: sideType, botId, cycleId });
    return { action: "idempotent", payload };
  }

  const claim = await tryClaimTradeExecutionLock({
    supabase,
    userId,
    symbol,
    side: sideType as "buy" | "sell",
    botId: String(botId),
    cycleId: String(cycleId),
  });
  if (claim === "duplicate") {
    execObserve("create_order_lock_duplicate", { symbol, side: sideType, botId, cycleId });
    return {
      action: "idempotent",
      payload: {
        idempotent: true,
        exchange_order_id: null,
        status: "duplicate_skipped",
        symbol,
        side: sideType,
        amount,
      },
    };
  }
  execObserve("create_order_lock_claimed", { symbol, side: sideType, botId, cycleId });
  return { action: "proceed" };
}

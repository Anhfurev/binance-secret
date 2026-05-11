// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { shouldPersistBotCycleTelemetryLog } from "./log-policy.ts";

/** HOLD/SKIP used to insert one account_balances row per symbol per minute → DB bloat. */
function shouldPersistBalanceSnapshot(
  action: "buy" | "sell" | "hold" | "skip",
): boolean {
  if (action === "buy" || action === "sell") return true;
  return String(Deno.env.get("TELEMETRY_ACCOUNT_BALANCE_ON_HOLD") ?? "")
    .trim() === "1";
}

export async function persistRunTelemetry(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  action: "buy" | "sell" | "hold" | "skip";
  detail: string;
  balance: number;
}) {
  const { supabase, userId, symbol, action, detail, balance } = params;
  const nowIso = new Date().toISOString();

  if (shouldPersistBalanceSnapshot(action)) {
    const balanceResult = await supabase.from("account_balances").insert([{
      user_id: userId,
      balance: Number(balance.toFixed(2)),
      timestamp: nowIso,
      extra: { symbol, action, detail },
    }]);
    if (balanceResult.error) {
      console.error(
        `[binance-bot] failed to write account_balances: ${balanceResult.error.message}`,
      );
    }
  }

  if (shouldPersistBotCycleTelemetryLog(action)) {
    const logResult = await supabase.from("logs").insert([{
      user_id: userId,
      symbol,
      level: "info",
      source: "bot-cycle",
      message: `action_${action}`,
      meta: { detail, balance: Number(balance.toFixed(2)) },
      created_at: nowIso,
    }]);
    if (logResult.error) {
      console.error(`[binance-bot] failed to write logs: ${logResult.error.message}`);
    }
  }
}
